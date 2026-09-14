# Install the Azure infrastructure

Part 1 of 2. Prepare an Azure subscription, a container registry, the application's
managed identity, and Microsoft Entra sign-in. Then follow
[Deploy the application](deploy-application.md) to build the images and create the
Container Apps hosting resources.

For a local-only installation, use [Getting started](getting-started.md).

## What you will deploy

| Stage | Resources | Template |
| --- | --- | --- |
| This guide | Resource group, Azure Container Registry (Basic), user-assigned managed identity, `AcrPull` role assignment | [registry.bicep](../infra/registry.bicep) |
| Application guide | Log Analytics, Container Apps environment, internal API, public web app, Entra authentication | [main.bicep](../infra/main.bicep) |
| Optional AI access | Inference and model-discovery role assignments on an existing Foundry account | [foundry-roles.bicep](../infra/foundry-roles.bicep) |

The split is intentional: the registry must exist before images can be built, and
the images must exist before the Container Apps are deployed. These templates do
not create a Foundry account, deploy models, or create Entra app registrations.
Azure resources incur charges, including when nobody is using the app.

## 1. Check prerequisites

- An Azure subscription and a region that supports Azure Container Apps and ACR.
- Permission to create a resource group and register resource providers at
  subscription scope, or an administrator who can do those steps for you.
- **Contributor** plus **User Access Administrator** on the target resource group
  to deploy resources and create role assignments. **Owner** also covers both.
- Permission to create an Entra app registration, manage its enterprise
  application, and assign users, or help from your tenant administrator. Azure
  subscription roles do not automatically grant these directory permissions.
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli),
  [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell),
  and Git.

All commands in these two guides use **PowerShell 7**, run from the repository
root. Local Docker, Node.js, and pnpm are not needed for this Azure path: ACR
builds the images in Azure. Stop after any failed command before continuing.

```powershell
git clone https://github.com/aj-enns/azure-architecture-review.git
Set-Location azure-architecture-review
az version
az bicep install
az extension add --name containerapp --upgrade
```

Skip cloning if you already have the repository open. Run `az bicep upgrade` if
Bicep is already installed and needs updating.

## 2. Select your subscription and create the resource group

Replace the subscription ID and choose a resource group and region. Keep `aar`
as the application name if you plan to use the supplied GitHub Actions workflow.

```powershell
$subscriptionId = '<your-subscription-id>'
$resourceGroup = 'rg-azure-architecture-review'
$location = 'eastus2'
$appName = 'aar'

az login
az account set --subscription $subscriptionId
az account show --query '{subscription:name,id:id,tenantId:tenantId}' --output table
$tenantId = az account show --query tenantId --output tsv
```

Confirm that the displayed subscription is correct before creating anything.
An administrator must perform the following commands if you have only
resource-group-scoped access. In that case, use the group they created.

```powershell
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.ContainerRegistry --wait
az provider register --namespace Microsoft.ManagedIdentity --wait
az group create --name $resourceGroup --location $location
```

## 3. Deploy the registry and managed identity

```powershell
az deployment group create `
  --name aar-registry `
  --resource-group $resourceGroup `
  --template-file infra/registry.bicep `
  --parameters name=$appName
```

Read the outputs after the deployment succeeds:

```powershell
$registry = az deployment group show `
  --resource-group $resourceGroup --name aar-registry `
  --query properties.outputs --output json | ConvertFrom-Json

$registry | ConvertTo-Json -Depth 5
```

You should see `acrName`, `acrLoginServer`, `identityId`, `identityClientId`, and
`identityPrincipalId`. These are identifiers, not passwords. The application
guide retrieves them again, so you do not need to copy them into a file.

## 4. Set up web sign-in

This is the **user-facing sign-in registration**, not the application's managed
identity and not the optional GitHub deployment identity.

1. In the [Azure portal](https://portal.azure.com), open **Microsoft Entra ID >
   App registrations > New registration** in the subscription's tenant.
2. Name it `Azure Architecture Review - Web`. Choose **Accounts in this
   organizational directory only**. Leave the redirect URI empty for now: the
   application URL is not known until Part 2. Register the application.
3. Record the **Application (client) ID** and **Directory (tenant) ID**. The client
   ID becomes `entraClientId`; the tenant ID becomes `entraTenantId`.
4. Under **Certificates & secrets**, create a client secret. Store its **Value**
   in your password manager, not its Secret ID. Set an expiry reminder. Do not
   paste the secret into chat, source control, or a literal shell command.
5. Open the corresponding **Enterprise application** (the **Managed application
   in local directory** link on the registration overview). Under **Properties**,
   set **Assignment required?** to **Yes**, then save.
6. Under **Users and groups**, assign yourself and the approved users. Group
   assignment requires appropriate Entra licensing; direct user assignments can
   be used where group assignment is unavailable. External collaborators must
   first be invited as guests into this tenant and then assigned access.

Part 2 adds the **Web** callback URI and enables **ID tokens (used for implicit
and hybrid flows)**, as required by the
[Container Apps Entra setup](https://learn.microsoft.com/azure/container-apps/authentication-entra).
The Bicep template configures the Container Apps identity provider; do not add a
second provider manually in the Container Apps portal.

Keep Entra authentication enabled. Without assignment-required, single-tenant
sign-in is not an allowlist of your intended collaborators. The backend uses the
host's identity and AI access, not each visitor's Azure credentials.

## 5. Optional: grant access to an existing Foundry account

Skip this step to run without AI. An existing account must have a compatible
chat-completion model deployment. The model value is the **deployment name**.

The application identity needs **Cognitive Services OpenAI User** for inference
and **Reader** for model discovery on the Foundry account. An administrator with
deployment and role-assignment permissions in that account's resource group can
run the following. A different subscription is supported within the same tenant.

```powershell
$foundrySubscriptionId = '<subscription-containing-foundry>'
$foundryResourceGroup = '<foundry-resource-group>'
$foundryAccountName = '<foundry-account-name>'
$identityPrincipalId = [guid]::Parse($registry.identityPrincipalId.value).ToString()

az deployment group create `
  --subscription $foundrySubscriptionId `
  --resource-group $foundryResourceGroup `
  --name aar-foundry-access `
  --template-file infra/foundry-roles.bicep `
  --parameters "foundryAccountName=$foundryAccountName" `
    "principalId=$identityPrincipalId"
```

The GUID conversion fails early if the registry output is missing or invalid.
If it fails, reload `$registry` using Step 3 in the application subscription.
Do not use `principalId=$registry.identityPrincipalId.value` directly: PowerShell
does not expand that property chain correctly inside a `name=value` argument.

This grants roles only; it does not configure the application's AI endpoint.
Have the resource endpoint, deployment name, and full Foundry resource ID ready
for Part 2. Network restrictions or model-specific access requirements must also
allow this application to connect. A successful role assignment does not prove
that inference works.

## Infrastructure handoff

Before continuing, confirm:

- The `aar-registry` deployment succeeded and has all five outputs.
- The sign-in app registration exists and you have its client ID and secret value.
- Assignment is required and at least your test user is assigned.
- If using AI, the application identity has the required Foundry access.

Continue with **[Deploy the application](deploy-application.md)**. It creates the
remaining hosting infrastructure, configures the callback, and verifies access.