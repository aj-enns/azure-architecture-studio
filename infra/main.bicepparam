using './main.bicep'

// For manual deploys. The GitHub Actions pipeline (.github/workflows/deploy.yml)
// passes these on the command line instead. Manual flow:
//   1. az deployment group create -g <rg> -f infra/registry.bicep -p name=aas
//      (note the acrLoginServer + identityId outputs)
//   2. az acr build -r <acrName> -t aas-api:<tag> -f apps/api/Dockerfile .
//      az acr build -r <acrName> -t aas-web:<tag> -f apps/web/Dockerfile .
//   3. az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam

param name = 'aas'

// From registry.bicep outputs.
param acrLoginServer = '<acrName>.azurecr.io'
param managedIdentityId = '/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/aas-id-<suffix>'
param managedIdentityClientId = '<identity-client-id>'

// Image tag pushed in step 2 (e.g. a git SHA).
param imageTag = 'latest'

// Azure deployments require Entra authentication by default. Register a
// single-tenant web application with this callback URI:
// https://<web-app-fqdn>/.auth/login/aad/callback
// Pass entraClientSecret securely on the deployment command line rather than
// storing it in this file. Set enableEntraAuth=false only when a trusted edge
// already authenticates every request.
param enableEntraAuth = true
param entraTenantId = '<tenant-id>'
param entraClientId = '<authentication-app-client-id>'

// Bring-your-own Microsoft Foundry (keyless via the managed identity). Leave
// blank to run without AI. Grant the identity roles on the Foundry resource
// (see README > Deploy to Azure).
param azureFoundryEndpoint = ''
param azureFoundryModel = ''
param azureFoundryResourceId = ''
