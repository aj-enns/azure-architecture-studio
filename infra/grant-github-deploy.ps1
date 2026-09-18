#requires -Version 7.0
<#
.SYNOPSIS
    One-time bootstrap for the GitHub Actions deployment identity: resource-group
    RBAC and OIDC federated credentials.

.DESCRIPTION
    Replaces the manual administrator steps in
    docs/deploy-application.md#automate-with-github-actions. Run once, with an
    administrator's Azure session, after the application resource group exists.
    The deployment identity cannot grant itself its initial access.

    Idempotent. It:
      1. Ensures the deployment service principal exists (optional creation).
    2. Grants Contributor, User Access Administrator, and AcrPush on the resource group.
      3. Optionally creates the branch + environment OIDC federated credentials.
      4. Prints the GitHub repository secrets and variables to configure.

    It does not create the app registration, the resource group, or the web
    sign-in identity, and it stores no secrets.

.EXAMPLE
    ./infra/grant-github-deploy.ps1 -SubscriptionId <sub> `
        -ResourceGroup rg-azure-architecture-studio `
        -DeploymentClientId <deploy-app-client-id> `
        -GitHubOwner aj-enns -GitHubRepo azure-architecture-studio

.NOTES
    Requires: PowerShell 7, Azure CLI, and role-assignment authority (Owner or
    User Access Administrator) at the resource-group scope. Creating federated
    credentials or the service principal also needs directory permissions.
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive bootstrap script reports progress to the host.')]
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SubscriptionId,

    [Parameter(Mandatory)]
    [string]$ResourceGroup,

    [Parameter(Mandatory)]
    [string]$DeploymentClientId,

    # Provide both to create OIDC federated credentials for GitHub Actions.
    [string]$GitHubOwner,
    [string]$GitHubRepo,
    [string]$Branch = 'main',
    [string]$Environment = 'production',

    # Create the service principal if it does not already exist.
    [switch]$CreateServicePrincipal
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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

# ---- Sign-in + scope --------------------------------------------------------
Write-Step 'Verifying Azure session and resource group'
az account show --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    az login --output none
    Assert-LastExit 'Azure sign-in'
}
az account set --subscription $SubscriptionId
Assert-LastExit 'Select subscription'

$groupId = az group show --subscription $SubscriptionId --name $ResourceGroup --query id --output tsv
Assert-LastExit 'Read resource group (create it first as part of infra setup)'

# ---- Service principal ------------------------------------------------------
Write-Step 'Resolving the deployment service principal'
$principalId = az ad sp show --id $DeploymentClientId --query id --output tsv 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($principalId)) {
    if (-not $CreateServicePrincipal) {
        throw "Deployment service principal not found for $DeploymentClientId. Re-run with -CreateServicePrincipal or have an administrator run 'az ad sp create --id $DeploymentClientId'."
    }
    $principalId = az ad sp create --id $DeploymentClientId --query id --output tsv
    Assert-LastExit 'Create service principal'
}
$principalId = [guid]::Parse($principalId).ToString()

# ---- Role assignments (idempotent) -----------------------------------------
Write-Step 'Granting Contributor, User Access Administrator, and AcrPush on the resource group'
foreach ($role in @('Contributor', 'User Access Administrator', 'AcrPush')) {
    $existing = az role assignment list `
        --subscription $SubscriptionId --scope $groupId `
        --assignee-object-id $principalId --role $role --query '[].id' --output tsv
    Assert-LastExit "Check $role assignment"
    if ([string]::IsNullOrWhiteSpace(($existing -join ''))) {
        az role assignment create `
            --subscription $SubscriptionId --scope $groupId `
            --assignee-object-id $principalId --assignee-principal-type ServicePrincipal `
            --role $role --output none
        Assert-LastExit "Grant $role"
        Write-Host "Granted: $role"
    } else {
        Write-Host "Already assigned: $role"
    }
}

# ---- OIDC federated credentials --------------------------------------------
if ($GitHubOwner -and $GitHubRepo) {
    Write-Step 'Creating GitHub OIDC federated credentials'
    $existingCreds = az ad app federated-credential list --id $DeploymentClientId --query '[].subject' --output json | ConvertFrom-Json
    Assert-LastExit 'List federated credentials'

    $wanted = @(
        @{ name = "github-branch-$Branch"; subject = "repo:$GitHubOwner/$GitHubRepo`:ref:refs/heads/$Branch" }
        @{ name = "github-env-$Environment"; subject = "repo:$GitHubOwner/$GitHubRepo`:environment:$Environment" }
    )
    foreach ($cred in $wanted) {
        if (@($existingCreds) -contains $cred.subject) {
            Write-Host "Already present: $($cred.subject)"
            continue
        }
        $parameters = @{
            name        = $cred.name
            issuer      = 'https://token.actions.githubusercontent.com'
            subject     = $cred.subject
            audiences   = @('api://AzureADTokenExchange')
            description = 'Azure Architecture Studio deploy'
        } | ConvertTo-Json
        # Pass JSON via @file: PowerShell strips quotes from inline az JSON strings.
        $credFile = New-TemporaryFile
        try {
            Set-Content -Path $credFile -Value $parameters -Encoding utf8
            az ad app federated-credential create --id $DeploymentClientId --parameters "@$($credFile.FullName)" --output none
            Assert-LastExit "Create federated credential $($cred.name)"
        } finally {
            Remove-Item $credFile -ErrorAction SilentlyContinue
        }
        Write-Host "Created: $($cred.subject)"
    }
}

# ---- Summary ----------------------------------------------------------------
Write-Step 'Bootstrap complete'
Write-Host 'Allow a few minutes for RBAC propagation before running GitHub Actions.'
Write-Host ''
Write-Host 'Configure these under Settings > Secrets and variables > Actions (repository scope):' -ForegroundColor Yellow
Write-Host '  Secret   AZURE_CLIENT_ID          = ' $DeploymentClientId
Write-Host '  Secret   AZURE_TENANT_ID          = <tenant id>'
Write-Host '  Secret   AZURE_SUBSCRIPTION_ID    = ' $SubscriptionId
Write-Host '  Secret   ENTRA_AUTH_CLIENT_SECRET = <web sign-in secret value>'
Write-Host '  Variable ENTRA_AUTH_CLIENT_ID     = <web sign-in client id>'
Write-Host '  Variable AZURE_RESOURCE_GROUP     = ' $ResourceGroup
Write-Host '  Variable AZURE_FOUNDRY_ENDPOINT / _MODEL / _RESOURCE_ID (optional, enable AI)'
if (-not ($GitHubOwner -and $GitHubRepo)) {
    Write-Host ''
    Write-Host 'Federated credentials were not created (pass -GitHubOwner and -GitHubRepo to add them).'
}
