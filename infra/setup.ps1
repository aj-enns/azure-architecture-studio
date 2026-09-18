#requires -Version 7.0
<#
.SYNOPSIS
    One-command Azure install for Azure Architecture Studio: infrastructure,
    container images, Container Apps, and Microsoft Entra "Easy Auth" sign-in.

.DESCRIPTION
    Replaces the manual walkthroughs in docs/install-infrastructure.md and
    docs/deploy-application.md. The script is idempotent - re-running it updates
    an existing installation rather than creating duplicates. It:

      1. Signs in / selects the subscription and registers resource providers.
      2. Creates the resource group (if missing).
      3. Deploys infra/registry.bicep (ACR + pull identity).
      4. Creates or reuses the Entra web sign-in app registration, its service
            principal, a client secret, ID-token issuance, assignment-required, and
            tenant-wide consent for the expected sign-in scopes.
      5. Builds both container images in ACR.
      6. Deploys infra/main.bicep with Entra authentication enabled.
      7. Patches the app registration's Easy Auth redirect URI to the deployed
         web hostname (removes the manual portal step).
      8. Optionally grants the app identity access to an existing Foundry account.

    Secrets are never written to disk in plaintext or echoed. A generated client
    secret is passed to the deployment through a temporary Bicep parameter file
    that references an environment variable; both are removed in a finally block.

.EXAMPLE
    ./infra/setup.ps1 -SubscriptionId <sub-id>

    Deploys without AI. Creates the Entra registration and a client secret,
    assigns you to the app, and wires the redirect URI automatically.

.EXAMPLE
    ./infra/setup.ps1 -SubscriptionId <sub-id> `
        -AssignGroups '<security-group-object-id>'

    Deploys without AI and assigns an existing Entra security group as the
    recommended ongoing access boundary.

.EXAMPLE
    ./infra/setup.ps1 -SubscriptionId <sub-id> `
        -FoundryEndpoint 'https://acct.services.ai.azure.com/' `
        -FoundryModel 'gpt-4o' `
        -FoundryResourceId '/subscriptions/<foundry-sub>/resourceGroups/<foundry-rg>/providers/Microsoft.CognitiveServices/accounts/acct'

    Deploys with AI enabled and grants the runtime identity Foundry access. The
    Foundry subscription, resource group, and account are derived from the ARM
    resource ID, so the account can be in another subscription in the same tenant.

.NOTES
    Requires: PowerShell 7, Azure CLI, and permission to create resource groups,
    role assignments, an Entra app registration, tenant-wide consent, and
    Enterprise Application assignments. Run from the repository root or any
    location - paths resolve relative to this script.
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive setup script reports progress to the host.')]
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SubscriptionId,

    [string]$ResourceGroup = 'rg-azure-architecture-studio',
    [string]$Location = 'canadacentral',
    [string]$AppName = 'aas',

    # --- Entra (Easy Auth) web sign-in registration -------------------------
    [string]$EntraAppDisplayName = 'Azure Architecture Studio - Web',
    # Reuse an existing registration by client id instead of creating one.
    [string]$EntraClientId,
    # Reuse an existing client secret instead of generating one.
    [securestring]$EntraClientSecret,
    # UPNs or object ids to assign to the enterprise application.
    [string[]]$AssignUsers,
    # Object ids or display names of security groups to assign (recommended).
    [string[]]$AssignGroups,

    # --- Optional AI (Microsoft Foundry) ------------------------------------
    [string]$FoundryEndpoint,
    [string]$FoundryModel,
    [string]$FoundryResourceId,
    # Optional compatibility overrides. When FoundryResourceId is provided,
    # these values are derived from it and any supplied values must match.
    [string]$FoundrySubscriptionId,
    [string]$FoundryResourceGroup,
    [string]$FoundryAccountName,

    # Deploy pre-built images with this tag instead of building here.
    [string]$ImageTag,
    [switch]$SkipImageBuild,
    [switch]$SkipProviderRegistration
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$infraDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $infraDir

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-LastExit {
    param([string]$What)
    if ($LASTEXITCODE -ne 0) {
        throw "$What failed (az exit code $LASTEXITCODE). Review the error above."
    }
}

function Invoke-AzRestJson {
    param(
        [Parameter(Mandatory)]
        [ValidateSet('POST', 'PATCH', 'PUT')]
        [string]$Method,

        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter(Mandatory)]
        [hashtable]$Body,

        [Parameter(Mandatory)]
        [string]$What
    )

    $jsonPath = [System.IO.Path]::GetTempFileName()
    try {
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        [System.IO.File]::WriteAllText(
            $jsonPath,
            $json,
            [System.Text.UTF8Encoding]::new($false))
        az rest --method $Method --uri $Uri `
            --headers 'Content-Type=application/json' `
            --body "@$jsonPath" --output none
        Assert-LastExit $What
    } finally {
        Remove-Item $jsonPath -Force -ErrorAction SilentlyContinue
    }
}

function Resolve-FoundryTarget {
    param(
        [Parameter(Mandatory)]
        [string]$ResourceId
    )

    $pattern = '^/subscriptions/(?<subscriptionId>[^/]+)/resourceGroups/(?<resourceGroup>[^/]+)/providers/Microsoft\.CognitiveServices/accounts/(?<accountName>[^/]+)/?$'
    $resourceMatch = [regex]::Match($ResourceId.Trim(), $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $resourceMatch.Success) {
        throw 'FoundryResourceId must be a Microsoft.CognitiveServices/accounts ARM resource ID.'
    }

    return [pscustomobject]@{
        SubscriptionId = $resourceMatch.Groups['subscriptionId'].Value
        ResourceGroup  = $resourceMatch.Groups['resourceGroup'].Value
        AccountName    = $resourceMatch.Groups['accountName'].Value
        ResourceId     = $ResourceId.Trim().TrimEnd('/')
    }
}

function Resolve-FoundrySetting {
    param(
        [AllowEmptyString()]
        [string]$ParameterValue,

        [Parameter(Mandatory)]
        [string]$EnvironmentName,

        [Parameter(Mandatory)]
        [hashtable]$DotEnv
    )

    if (-not [string]::IsNullOrWhiteSpace($ParameterValue)) {
        return $ParameterValue
    }

    $environmentValue = [Environment]::GetEnvironmentVariable($EnvironmentName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($environmentValue)) {
        return $environmentValue
    }

    if ($DotEnv.ContainsKey($EnvironmentName)) {
        return $DotEnv[$EnvironmentName]
    }

    return ''
}

$dotEnv = @{}
$dotEnvPath = Join-Path $repoRoot '.env'
if (Test-Path $dotEnvPath) {
    foreach ($line in Get-Content $dotEnvPath) {
        if ($line -match '^\s*(AZURE_FOUNDRY_(?:ENDPOINT|MODEL|RESOURCE_ID))\s*=\s*(.*)$') {
            $dotEnv[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
}

$FoundryEndpoint = Resolve-FoundrySetting `
    -ParameterValue $FoundryEndpoint `
    -EnvironmentName 'AZURE_FOUNDRY_ENDPOINT' `
    -DotEnv $dotEnv
$FoundryModel = Resolve-FoundrySetting `
    -ParameterValue $FoundryModel `
    -EnvironmentName 'AZURE_FOUNDRY_MODEL' `
    -DotEnv $dotEnv
$FoundryResourceId = Resolve-FoundrySetting `
    -ParameterValue $FoundryResourceId `
    -EnvironmentName 'AZURE_FOUNDRY_RESOURCE_ID' `
    -DotEnv $dotEnv

if ($SkipImageBuild -and [string]::IsNullOrWhiteSpace($ImageTag)) {
    throw 'Provide -ImageTag when using -SkipImageBuild so existing images can be resolved.'
}

if (-not [string]::IsNullOrWhiteSpace($FoundryResourceId)) {
    $foundryTarget = Resolve-FoundryTarget -ResourceId $FoundryResourceId
    $foundryOverrides = @(
        @{ Name = 'FoundrySubscriptionId'; Value = $FoundrySubscriptionId; Expected = $foundryTarget.SubscriptionId },
        @{ Name = 'FoundryResourceGroup'; Value = $FoundryResourceGroup; Expected = $foundryTarget.ResourceGroup },
        @{ Name = 'FoundryAccountName'; Value = $FoundryAccountName; Expected = $foundryTarget.AccountName }
    )
    foreach ($foundryOverride in $foundryOverrides) {
        if (-not [string]::IsNullOrWhiteSpace($foundryOverride.Value) -and
            $foundryOverride.Value -ine $foundryOverride.Expected) {
            throw "$($foundryOverride.Name) does not match FoundryResourceId."
        }
    }

    $FoundrySubscriptionId = $foundryTarget.SubscriptionId
    $FoundryResourceGroup = $foundryTarget.ResourceGroup
    $FoundryAccountName = $foundryTarget.AccountName
    $FoundryResourceId = $foundryTarget.ResourceId
}

$foundryLocationCount = @(
    $FoundrySubscriptionId,
    $FoundryResourceGroup,
    $FoundryAccountName
).Where({ -not [string]::IsNullOrWhiteSpace($_) }).Count
if ($foundryLocationCount -notin 0, 3) {
    throw 'Provide FoundryResourceId, or provide all three Foundry location overrides.'
}

# ---- 0. Tooling + sign-in ---------------------------------------------------
Write-Step 'Checking Azure CLI and signing in'
az version --output none
Assert-LastExit 'Azure CLI check'

try {
    az bicep version --only-show-errors --output none 2>$null
    if ($LASTEXITCODE -ne 0) { az bicep install --only-show-errors }
} catch {
    az bicep install --only-show-errors
}
az extension add --name containerapp --upgrade --only-show-errors --output none
Assert-LastExit 'Container Apps CLI extension'

az account show --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    az login --output none
    Assert-LastExit 'Azure sign-in'
}
az account set --subscription $SubscriptionId
Assert-LastExit 'Select subscription'

$account = az account show --output json | ConvertFrom-Json
Assert-LastExit 'Read account'
$tenantId = $account.tenantId
Write-Host "Subscription: $($account.name) ($($account.id))"
Write-Host "Tenant:       $tenantId"

# ---- 1. Providers + resource group -----------------------------------------
if (-not $SkipProviderRegistration) {
    Write-Step 'Registering resource providers'
    foreach ($ns in @(
            'Microsoft.App',
            'Microsoft.OperationalInsights',
            'Microsoft.ContainerRegistry',
            'Microsoft.ManagedIdentity')) {
        az provider register --namespace $ns --wait
        Assert-LastExit "Register provider $ns"
    }
}

Write-Step "Ensuring resource group '$ResourceGroup'"
az group create --name $ResourceGroup --location $Location --output none
Assert-LastExit 'Create resource group'

# ---- 2. Registry + pull identity -------------------------------------------
Write-Step 'Deploying registry and managed identity (registry.bicep)'
$registry = az deployment group create `
    --name "$AppName-registry" `
    --resource-group $ResourceGroup `
    --template-file (Join-Path $infraDir 'registry.bicep') `
    --parameters name=$AppName `
    --query properties.outputs --output json | ConvertFrom-Json
Assert-LastExit 'Registry deployment'

$acrName = $registry.acrName.value
$acrLoginServer = $registry.acrLoginServer.value
$managedIdentityId = $registry.identityId.value
$managedIdentityClientId = $registry.identityClientId.value
$identityPrincipalId = [guid]::Parse($registry.identityPrincipalId.value).ToString()
Write-Host "Registry:  $acrLoginServer"
Write-Host "Identity:  $managedIdentityClientId"

# ---- 3. Entra web sign-in registration -------------------------------------
Write-Step 'Configuring the Entra (Easy Auth) sign-in registration'
if ([string]::IsNullOrWhiteSpace($EntraClientId)) {
    $existing = az ad app list --display-name $EntraAppDisplayName --query '[0].appId' --output tsv
    Assert-LastExit 'Look up app registration'
    if ([string]::IsNullOrWhiteSpace($existing)) {
        Write-Host "Creating app registration '$EntraAppDisplayName'"
        $EntraClientId = az ad app create `
            --display-name $EntraAppDisplayName `
            --sign-in-audience AzureADMyOrg `
            --enable-id-token-issuance true `
            --query appId --output tsv
        Assert-LastExit 'Create app registration'
    } else {
        $EntraClientId = $existing
        Write-Host "Reusing existing registration $EntraClientId"
    }
}

# Ensure the enterprise application (service principal) exists.
$spObjectId = az ad sp show --id $EntraClientId --query id --output tsv 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($spObjectId)) {
    $spObjectId = az ad sp create --id $EntraClientId --query id --output tsv
    Assert-LastExit 'Create service principal'
}

# Idempotent hardening: ID tokens on, assignment required on.
az ad app update --id $EntraClientId --enable-id-token-issuance true
Assert-LastExit 'Enable ID token issuance'
Invoke-AzRestJson -Method PATCH `
    -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId" `
    -Body @{ appRoleAssignmentRequired = $true } `
    -What 'Set assignment-required'

# Assignment-required prevents users from granting their own consent. Grant only
# the known sign-in scopes on behalf of the tenant; assignments still control
# which users and groups can sign in.
$graphAppId = '00000003-0000-0000-c000-000000000000'
$graphSp = az ad sp show --id $graphAppId --output json | ConvertFrom-Json
Assert-LastExit 'Look up Microsoft Graph service principal'
$graphSpObjectId = $graphSp.id
$consentScopes = @('openid', 'profile', 'email')
$allowedConsentScopes = @($consentScopes + 'User.Read')
$requiredResourceAccess = @(az ad app show --id $EntraClientId `
        --query requiredResourceAccess --output json | ConvertFrom-Json)
Assert-LastExit 'Read web sign-in application permissions'
$unexpectedPermissions = [System.Collections.Generic.List[string]]::new()
foreach ($resourceAccess in $requiredResourceAccess) {
    foreach ($permissionAccess in @($resourceAccess.resourceAccess)) {
        $resolvedScopes = @($graphSp.oauth2PermissionScopes | Where-Object {
                $_.id -eq $permissionAccess.id
            })
        if ($resourceAccess.resourceAppId -ne $graphAppId -or
            $permissionAccess.type -ne 'Scope' -or
            $resolvedScopes.Count -ne 1 -or
            $resolvedScopes[0].value -notin $allowedConsentScopes) {
            $unexpectedPermissions.Add(
                "$($resourceAccess.resourceAppId)/$($permissionAccess.type)/$($permissionAccess.id)")
            continue
        }
        if ($resolvedScopes[0].value -notin $consentScopes) {
            $consentScopes += $resolvedScopes[0].value
        }
    }
}
if ($unexpectedPermissions.Count -gt 0) {
    throw "The web sign-in registration requests unexpected API permissions: $($unexpectedPermissions -join ', '). Use a dedicated registration or have an administrator review it before granting consent."
}
$permissionGrants = az rest --method GET `
    --uri "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?`$filter=clientId%20eq%20'$spObjectId'" `
    --query value --output json | ConvertFrom-Json
Assert-LastExit 'Read delegated permission grants'
$tenantGrant = @($permissionGrants | Where-Object {
        $_.consentType -eq 'AllPrincipals' -and $_.resourceId -eq $graphSpObjectId
    } | Select-Object -First 1)

if ($tenantGrant.Count -eq 0) {
    Invoke-AzRestJson -Method POST `
        -Uri 'https://graph.microsoft.com/v1.0/oauth2PermissionGrants' `
        -Body @{
            clientId     = $spObjectId
            consentType  = 'AllPrincipals'
            principalId  = $null
            resourceId   = $graphSpObjectId
            scope        = $consentScopes -join ' '
        } `
        -What 'Grant tenant-wide Easy Auth consent'
    Write-Host 'Granted tenant-wide consent for Easy Auth sign-in scopes.'
} else {
    $grantedScopes = @($tenantGrant[0].scope -split '\s+' | Where-Object { $_ })
    $missingScopes = @($consentScopes | Where-Object { $_ -notin $grantedScopes })
    if ($missingScopes.Count -gt 0) {
        $updatedScopes = @($grantedScopes + $missingScopes | Select-Object -Unique) -join ' '
        Invoke-AzRestJson -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/oauth2PermissionGrants/$($tenantGrant[0].id)" `
            -Body @{ scope = $updatedScopes } `
            -What 'Update tenant-wide Easy Auth consent'
        Write-Host 'Updated tenant-wide consent for Easy Auth sign-in scopes.'
    } else {
        Write-Host 'Tenant-wide Easy Auth consent already configured.'
    }
}

# Assign the current user (and any -AssignUsers) so sign-in works immediately.
$assignTargets = [System.Collections.Generic.List[string]]::new()
$signedInUser = az ad signed-in-user show --query id --output tsv 2>$null
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($signedInUser)) {
    $assignTargets.Add($signedInUser)
}
foreach ($user in @($AssignUsers)) {
    if ([string]::IsNullOrWhiteSpace($user)) { continue }
    $objectId = az ad user show --id $user --query id --output tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($objectId)) {
        $assignTargets.Add($objectId)
    } else {
        throw "Could not resolve user '$user'. For a guest, use its object id or #EXT# user principal name."
    }
}
foreach ($group in @($AssignGroups)) {
    if ([string]::IsNullOrWhiteSpace($group)) { continue }
    $groupDetails = az ad group show --group $group `
        --query '{id:id,displayName:displayName,securityEnabled:securityEnabled}' `
        --output json 2>$null | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($groupDetails.id)) {
        throw "Could not resolve group '$group'. Prefer its Entra object id."
    }
    if (-not $groupDetails.securityEnabled) {
        throw "Group '$($groupDetails.displayName)' is not security-enabled. Use an Entra security group."
    }
    $assignTargets.Add($groupDetails.id)
}
$appAssignments = az rest --method GET `
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/appRoleAssignedTo" `
    --query value --output json | ConvertFrom-Json
Assert-LastExit 'Read enterprise application assignments'
foreach ($principalId in ($assignTargets | Select-Object -Unique)) {
    if (@($appAssignments | Where-Object { $_.principalId -eq $principalId }).Count -gt 0) {
        Write-Host "Enterprise application assignment already exists for $principalId."
        continue
    }
    Invoke-AzRestJson -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/appRoleAssignedTo" `
        -Body @{
            principalId = $principalId
            resourceId  = $spObjectId
            appRoleId   = '00000000-0000-0000-0000-000000000000'
        } `
        -What "Assign enterprise application access to $principalId"
}

# Obtain a client secret: reuse the supplied one, otherwise generate + append.
$generatedSecret = $false
if ($EntraClientSecret) {
    $secretPlain = [System.Net.NetworkCredential]::new('', $EntraClientSecret).Password
} else {
    Write-Host 'Generating a client secret (valid 1 year)'
    $secretPlain = az ad app credential reset `
        --id $EntraClientId --append --years 1 --query password --output tsv
    Assert-LastExit 'Create client secret'
    $generatedSecret = $true
}

# ---- 4. Optional Foundry role grant ----------------------------------------
if ($FoundrySubscriptionId -and $FoundryResourceGroup -and $FoundryAccountName) {
    Write-Step 'Granting the runtime identity access to the Foundry account'
    $foundryTenantId = az account show `
        --subscription $FoundrySubscriptionId --query tenantId --output tsv
    Assert-LastExit 'Read Foundry subscription tenant'
    if ($foundryTenantId -ne $tenantId) {
        throw 'The application identity and Foundry account must be in subscriptions in the same Microsoft Entra tenant.'
    }
    az deployment group create `
        --subscription $FoundrySubscriptionId `
        --resource-group $FoundryResourceGroup `
        --name "$AppName-foundry-access" `
        --template-file (Join-Path $infraDir 'foundry-roles.bicep') `
        --parameters "foundryAccountName=$FoundryAccountName" "principalId=$identityPrincipalId" `
        --output none
    Assert-LastExit 'Foundry role assignment'
}

# ---- 5. Build both images ---------------------------------------------------
if (-not $SkipImageBuild) {
    if ([string]::IsNullOrWhiteSpace($ImageTag)) {
        $ImageTag = 'setup-' + (Get-Date -Format 'yyyyMMddHHmmss')
    }
    Write-Step "Building images in ACR (tag $ImageTag)"
    Push-Location $repoRoot
    try {
        az acr build --registry $acrName `
            --image "aas-api:$ImageTag" --file apps/api/Dockerfile .
        $useLocalBuild = $LASTEXITCODE -ne 0

        if (-not $useLocalBuild) {
            az acr build --registry $acrName `
                --image "aas-web:$ImageTag" --file apps/web/Dockerfile .
            $useLocalBuild = $LASTEXITCODE -ne 0
        }

        if ($useLocalBuild) {
            Write-Warning 'ACR Quick Build failed. Falling back to the local Docker engine.'
            docker version --format '{{.Server.Os}}/{{.Server.Arch}}' | Out-Null
            Assert-LastExit 'Local Docker check'
            az acr login --name $acrName --subscription $SubscriptionId --output none
            Assert-LastExit 'Registry sign-in'

            docker build --tag "$acrLoginServer/aas-api:$ImageTag" `
                --file apps/api/Dockerfile .
            Assert-LastExit 'Local API image build'
            docker push "$acrLoginServer/aas-api:$ImageTag"
            Assert-LastExit 'API image push'

            docker build --tag "$acrLoginServer/aas-web:$ImageTag" `
                --file apps/web/Dockerfile .
            Assert-LastExit 'Local web image build'
            docker push "$acrLoginServer/aas-web:$ImageTag"
            Assert-LastExit 'Web image push'
        }
    } finally {
        Pop-Location
    }
}

# ---- 6. Deploy the application (main.bicep) ---------------------------------
Write-Step "Deploying the application (main.bicep, tag $ImageTag)"
$parameterPath = Join-Path $infraDir ".aas-deploy-$([guid]::NewGuid()).bicepparam"
try {
    $env:AAS_ENTRA_CLIENT_SECRET = $secretPlain

    @"
using './main.bicep'
param name = '$AppName'
param acrLoginServer = '$acrLoginServer'
param managedIdentityId = '$managedIdentityId'
param managedIdentityClientId = '$managedIdentityClientId'
param imageTag = '$ImageTag'
param enableEntraAuth = true
param entraTenantId = '$tenantId'
param entraClientId = '$EntraClientId'
param entraClientSecret = readEnvironmentVariable('AAS_ENTRA_CLIENT_SECRET')
param azureFoundryEndpoint = '$FoundryEndpoint'
param azureFoundryModel = '$FoundryModel'
param azureFoundryResourceId = '$FoundryResourceId'
"@ | Set-Content -Path $parameterPath -Encoding utf8

    $app = az deployment group create `
        --name "$AppName-app" `
        --resource-group $ResourceGroup `
        --parameters $parameterPath `
        --query properties.outputs --output json | ConvertFrom-Json
    Assert-LastExit 'Application deployment'
} finally {
    Remove-Item Env:AAS_ENTRA_CLIENT_SECRET -ErrorAction SilentlyContinue
    Remove-Item $parameterPath -ErrorAction SilentlyContinue
    $secretPlain = $null
}

$webFqdn = $app.webFqdn.value
$redirectUri = $app.entraRedirectUri.value

# ---- 7. Patch the Easy Auth redirect URI (was the manual portal step) -------
Write-Step 'Registering the Easy Auth redirect URI'
$currentUris = az ad app show --id $EntraClientId --query 'web.redirectUris' --output json | ConvertFrom-Json
Assert-LastExit 'Read redirect URIs'
$mergedUris = @($currentUris) + $redirectUri |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique
az ad app update --id $EntraClientId --web-redirect-uris $mergedUris
Assert-LastExit 'Update redirect URI'

# ---- Done -------------------------------------------------------------------
Write-Step 'Installation complete'
Write-Host "Application: https://$webFqdn"
Write-Host "Callback:    $redirectUri"
Write-Host "Client ID:   $EntraClientId"
if ($generatedSecret) {
    Write-Host ''
    Write-Warning 'A new client secret was generated and used for this deployment.'
    Write-Warning 'It was not printed. Rotate it before expiry and redeploy with the new value.'
}
Write-Host ''
Write-Host 'Verify (see docs/deploy-application.md step 6):' -ForegroundColor Yellow
Write-Host '  - Open the URL in a private window; you should be redirected to sign in.'
Write-Host '  - Sign in as an assigned user; the canvas should load.'
Write-Host '  - An unassigned user should be denied.'
