using './main.bicep'

// For manual deploys. The GitHub Actions pipeline (.github/workflows/deploy.yml)
// passes these on the command line instead. Manual flow:
//   1. az deployment group create -g <rg> -f infra/registry.bicep -p name=aar
//      (note the acrLoginServer + identityId outputs)
//   2. az acr build -r <acrName> -t aar-api:<tag> -f apps/api/Dockerfile .
//      az acr build -r <acrName> -t aar-web:<tag> -f apps/web/Dockerfile .
//   3. az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam

param name = 'aar'

// From registry.bicep outputs.
param acrLoginServer = '<acrName>.azurecr.io'
param managedIdentityId = '/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/aar-id-<suffix>'
param managedIdentityClientId = '<identity-client-id>'

// Image tag pushed in step 2 (e.g. a git SHA).
param imageTag = 'latest'

// Bring-your-own Microsoft Foundry (keyless via the managed identity). Leave
// blank to run without AI. Grant the identity roles on the Foundry resource
// (see README > Deploy to Azure).
param azureFoundryEndpoint = ''
param azureFoundryModel = ''
param azureFoundryResourceId = ''
