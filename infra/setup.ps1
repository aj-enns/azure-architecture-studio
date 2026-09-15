#requires -Version 7.0
<#
.SYNOPSIS
    One-command Azure install for Azure Architecture Review: infrastructure,
    container images, Container Apps, and Microsoft Entra "Easy Auth" sign-in.

.DESCRIPTION
    Replaces the manual walkthroughs in docs/install-infrastructure.md and
    docs/deploy-application.md. The script is idempotent - re-running it updates
    an existing installation rather than creating duplicates. It:

      1. Signs in / selects the subscription and registers resource providers.
      2. Creates the resource group (if missing).
      3. Deploys infra/registry.bicep (ACR + pull identity).
      4. Creates or reuses the Entra web sign-in app registration, its service
         principal, a client secret, ID-token issuance, and assignment-required.
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
        -FoundryEndpoint 'https://acct.services.ai.azure.com/' `
        -FoundryModel 'gpt-4o' `
        -FoundryResourceId '/subscriptions/.../accounts/acct' `
        -FoundrySubscriptionId <sub> -FoundryResourceGroup <rg> -FoundryAccountName acct

    Deploys with AI enabled and grants the runtime identity Foundry access.

.NOTES
    Requires: PowerShell 7, Azure CLI, and permission to create resource groups,
    role assignments, and an Entra app registration (Application Developer or
    equivalent). Run from the repository root or any location - paths resolve
    relative to this script.
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive setup script reports progress to the host.')]
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SubscriptionId,

    [string]$ResourceGroup = 'rg-azure-architecture-review',
    [string]$Location = 'eastus2',
    [string]$AppName = 'aar',

    # --- Entra (Easy Auth) web sign-in registration -------------------------
    [string]$EntraAppDisplayName = 'Azure Architecture Review - Web',
    # Reuse an existing registration by client id instead of creating one.
    [string]$EntraClientId,
    # Reuse an existing client secret instead of generating one.
    [securestring]$EntraClientSecret,
    # UPNs or object ids to assign to the enterprise application.
    [string[]]$AssignUsers,

    # --- Optional AI (Microsoft Foundry) ------------------------------------
    [string]$FoundryEndpoint,
    [string]$FoundryModel,
    [string]$FoundryResourceId,
    # Provide all three to grant the runtime identity Foundry roles.
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

if ($SkipImageBuild -and [string]::IsNullOrWhiteSpace($ImageTag)) {
    throw 'Provide -ImageTag when using -SkipImageBuild so existing images can be resolved.'
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
az rest --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId" `
    --headers 'Content-Type=application/json' `
    --body '{"appRoleAssignmentRequired": true}' --output none
Assert-LastExit 'Set assignment-required'

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
        Write-Warning "Could not resolve user '$user'; assign them manually."
    }
}
foreach ($principalId in ($assignTargets | Select-Object -Unique)) {
    $body = @{
        principalId = $principalId
        resourceId  = $spObjectId
        appRoleId   = '00000000-0000-0000-0000-000000000000'
    } | ConvertTo-Json -Compress
    az rest --method POST `
        --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/appRoleAssignedTo" `
        --headers 'Content-Type=application/json' `
        --body $body --output none 2>$null
    # A 409/400 means the assignment already exists - safe to ignore.
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
            --image "aar-api:$ImageTag" --file apps/api/Dockerfile .
        Assert-LastExit 'API image build'
        az acr build --registry $acrName `
            --image "aar-web:$ImageTag" --file apps/web/Dockerfile .
        Assert-LastExit 'Web image build'
    } finally {
        Pop-Location
    }
}

# ---- 6. Deploy the application (main.bicep) ---------------------------------
Write-Step "Deploying the application (main.bicep, tag $ImageTag)"
$parameterPath = Join-Path $infraDir ".aar-deploy-$([guid]::NewGuid()).bicepparam"
try {
    $env:AAR_ENTRA_CLIENT_SECRET = $secretPlain

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
param entraClientSecret = readEnvironmentVariable('AAR_ENTRA_CLIENT_SECRET')
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
    Remove-Item Env:AAR_ENTRA_CLIENT_SECRET -ErrorAction SilentlyContinue
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
az ad app update --id $EntraClientId --web-redirect-uris @mergedUris
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
