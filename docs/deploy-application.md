# Deploy the application

Part 2 of 2. Build the web and API images, deploy them to Azure Container Apps,
and verify Entra sign-in. Complete [Install the Azure infrastructure](install-infrastructure.md)
first. For a local developer installation instead, use [Getting started](getting-started.md).

Start with the manual deployment below. After it works, the optional
[GitHub Actions setup](#automate-with-github-actions) can automate later releases.

> Local `.env` settings are **not loaded** by these Azure deployments. Supply
> Foundry settings as Bicep parameters below or GitHub Actions variables. Azure
> uses the application's managed identity, not your local `az login` session.

## 1. Load your infrastructure settings

Run these commands in PowerShell 7 from the repository root. Use the same
subscription and resource group as Part 1. Stop after any failed command.

```powershell
$subscriptionId = '<your-subscription-id>'
$resourceGroup = 'rg-azure-architecture-review'
$appName = 'aar'
$entraClientId = '<web-sign-in-application-client-id>'

az login
az account set --subscription $subscriptionId
az account show --query '{subscription:name,id:id,tenantId:tenantId}' --output table
$tenantId = az account show --query tenantId --output tsv

$registry = az deployment group show `
  --resource-group $resourceGroup --name aar-registry `
  --query properties.outputs --output json | ConvertFrom-Json
```

Confirm the subscription before proceeding. If the registry deployment cannot be
found, finish Part 1 or correct the subscription/resource group.

## 2. Build both container images

Local package commands and both Dockerfiles default to the Microsoft npm feed
`https://packagefeedproxy.microsoft.io/npm/`. Docker installs the pinned
`pnpm@9.15.9` with npm because this feed does not serve the version-specific
metadata endpoint used by Corepack. TLS verification remains enabled.
To select another approved feed for a Docker build, pass
`--build-arg NPM_REGISTRY=https://<registry-path>` (without a trailing slash).
Existing lockfile tarball URLs remain in effect; a registry override does not
rewrite them.

ACR builds from your local working directory, including uncommitted source
changes not excluded from the build context. Use a reviewed checkout and do not
include sensitive files in the build context. Each release gets a unique tag;
both images must use the same tag.

```powershell
$imageTag = 'manual-' + (Get-Date -Format 'yyyyMMddHHmmss')

az acr build --registry $registry.acrName.value `
  --image "aar-api:$imageTag" --file apps/api/Dockerfile .
if ($LASTEXITCODE -ne 0) { throw 'API image build failed.' }

az acr build --registry $registry.acrName.value `
  --image "aar-web:$imageTag" --file apps/web/Dockerfile .
if ($LASTEXITCODE -ne 0) { throw 'Web image build failed.' }
```

Do not deploy until both builds succeed. Local Docker is not required.

## 3. Choose the AI configuration

For an initial installation without AI, leave all three values empty:

```powershell
$foundryEndpoint = ''
$foundryModel = ''
$foundryResourceId = ''
```

To enable AI, replace them before deploying:

```powershell
$foundryEndpoint = 'https://<account>.services.ai.azure.com/'
$foundryModel = '<existing-model-deployment-name>'
$foundryResourceId = '/subscriptions/<subscription-id>/resourceGroups/<foundry-rg>/providers/Microsoft.CognitiveServices/accounts/<account>'
```

All three must describe the same Foundry account. Use the resource-level model
inference endpoint, not a project URL. The resource ID enables review model
discovery; it is optional for inference. Complete the Foundry role grants in
Part 1 before testing AI. No API key is needed. The supplied Azure templates wire
Foundry configuration; the local app's Azure OpenAI environment variables are
not automatically passed through by these templates.

## 4. Deploy the hosting resources and application

This step creates Log Analytics, the Container Apps environment, the internal
API, and the public web app. Entra authentication stays enabled throughout the
deployment; the first sign-in will work only after Step 5 is complete.

Use the same PowerShell session as Steps 1 through 3. Variables are not shared
between terminal tabs or retained after closing a terminal. If you switched
sessions, repeat Step 1, restore the image tag actually pushed to ACR, and set the
AI values again. Local Docker images alone are not sufficient for Azure deployment.

Run the whole block below. Enter the sign-in registration's client secret
**value** at the masked terminal prompt. A temporary Bicep parameter file refers
to an environment variable, so it contains no literal secret. The `finally`
block removes the file and environment variable after deployment, including on
failure. Do not run Bicep parameter-output commands or enable CLI debug logging
while the secret is loaded. If you forcibly close the terminal, remove any
leftover `.aar-deploy-*.bicepparam` file from the infrastructure folder.

```powershell
$requiredSettings = @{
  subscriptionId = $subscriptionId
  resourceGroup = $resourceGroup
  appName = $appName
  tenantId = $tenantId
  entraClientId = $entraClientId
  imageTag = $imageTag
  acrName = $registry.acrName.value
  acrLoginServer = $registry.acrLoginServer.value
  managedIdentityId = $registry.identityId.value
  managedIdentityClientId = $registry.identityClientId.value
}
foreach ($setting in $requiredSettings.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace([string]$setting.Value) -or [string]$setting.Value -match '[<>]') {
    throw "Missing or placeholder setting: $($setting.Key). Restore Steps 1 through 3 in this terminal."
  }
}
foreach ($imageRepository in @('aar-api', 'aar-web')) {
  az acr repository show --subscription $subscriptionId `
    --name $registry.acrName.value --image "${imageRepository}:$imageTag" `
    --query name --output tsv
  if ($LASTEXITCODE -ne 0) {
    throw "Cannot access ${imageRepository}:$imageTag in ACR. Build and push both images before deploying."
  }
}

$parameterPath = Join-Path (Resolve-Path infra) ".aar-deploy-$([guid]::NewGuid()).bicepparam"
try {
    $env:AAR_ENTRA_CLIENT_SECRET = Read-Host 'Web sign-in client secret value' -MaskInput
    if ([string]::IsNullOrWhiteSpace($env:AAR_ENTRA_CLIENT_SECRET)) {
        throw 'A web sign-in client secret is required.'
    }

    @"
using './main.bicep'
param name = '$appName'
param acrLoginServer = '$($registry.acrLoginServer.value)'
param managedIdentityId = '$($registry.identityId.value)'
param managedIdentityClientId = '$($registry.identityClientId.value)'
param imageTag = '$imageTag'
param enableEntraAuth = true
param entraTenantId = '$tenantId'
param entraClientId = '$entraClientId'
param entraClientSecret = readEnvironmentVariable('AAR_ENTRA_CLIENT_SECRET')
param azureFoundryEndpoint = '$foundryEndpoint'
param azureFoundryModel = '$foundryModel'
param azureFoundryResourceId = '$foundryResourceId'
"@ | Set-Content -Path $parameterPath -Encoding utf8

    az deployment group create `
      --subscription $subscriptionId `
      --name aar-app --resource-group $resourceGroup `
      --parameters $parameterPath `
      --query properties.outputs --output json
    if ($LASTEXITCODE -ne 0) { throw 'Application deployment failed.' }
}
finally {
    Remove-Item Env:AAR_ENTRA_CLIENT_SECRET -ErrorAction SilentlyContinue
    Remove-Item $parameterPath -ErrorAction SilentlyContinue
}
```

The temporary file points to [main.bicep](../infra/main.bicep); there is no need to
edit the tracked [main.bicepparam](../infra/main.bicepparam) for this procedure.
Use plain identifier, URL, and tag values without single quotes in the inputs.

## 5. Finish Entra sign-in

Retrieve the application URL and callback:

```powershell
$app = az deployment group show `
  --resource-group $resourceGroup --name aar-app `
  --query properties.outputs --output json | ConvertFrom-Json

"Application: https://$($app.webFqdn.value)"
"Callback: $($app.entraRedirectUri.value)"
```

1. In **Microsoft Entra ID > App registrations**, open the **web sign-in**
   registration from Part 1, not a GitHub deployment registration.
2. Under **Authentication**, add a **Web** platform redirect URI using the exact
   callback output: `https://<web-fqdn>/.auth/login/aad/callback`. Do not select SPA.
3. Enable **ID tokens (used for implicit and hybrid flows)** in Authentication
   settings and save, per the
   [Container Apps instructions](https://learn.microsoft.com/azure/container-apps/authentication-entra).
   No separate native client or daemon registration is needed for browser sign-in.
4. Confirm **Assignment required? = Yes** on the enterprise application and that
   your test user is assigned. Apply your organization's consent and Conditional
   Access requirements with your tenant administrator.

Repeat the callback configuration if the hostname changes. A normal image update
to the same Container App does not require a new callback.

## 6. Verify the installation

Do not treat a successful ARM deployment as an end-to-end pass. Test all of these:

| Check | Expected result |
| --- | --- |
| Open the application URL in a private browser window | Redirect to Microsoft sign-in before the canvas is accessible |
| Sign in as an assigned user | Canvas loads and the service catalog is available |
| Open `https://<web-fqdn>/healthz` in that signed-in browser | Successful API health response, not a redirect loop or gateway error |
| Use a separate private session with an unassigned tenant user | Access denied |
| Drag a service onto the canvas and run validation | Non-AI workflow works |
| If enabled, make a small AI request | A model response, without configuration or permission errors |

Both `/api` and `/healthz` pass through the web authentication boundary. An
unauthenticated health request can redirect to sign-in; it is not a public
liveness endpoint in this deployment. The API has internal ingress and should
not be exposed publicly to bypass a proxy or authentication failure.

If a check fails, stop before inviting collaborators. This guide describes the
current templates; it is not evidence that they have passed a live deployment.

## Automate with GitHub Actions

Use this after a successful manual installation. The
[deploy workflow](../.github/workflows/deploy.yml) provisions the registry and
identity again, builds images tagged with the commit SHA, then deploys the app.
It uses `name=aar`; keep the same resource group and name to update this installation.

### 1. Create a separate deployment identity

Create a single-tenant app registration such as `Azure Architecture Review - Deploy`
and ensure it has a service principal (enterprise application) in the tenant.
It needs no web callback or client secret. If the service principal is absent,
an authorized administrator can create it:

```powershell
az ad sp create --id '<deployment-application-client-id>'
```

On the **existing application resource group**, grant this service principal
**Contributor** plus **User Access Administrator**. These permit resource
deployment, ACR builds, and the registry's role assignment. Pre-create the group
and register providers using Part 1; group-scoped permissions cannot bootstrap
a new resource group. Foundry grants remain a separate administrator step.

### 2. Configure both OIDC federated credentials

In the deployment registration, open **Certificates & secrets > Federated
credentials > Add credential > GitHub Actions deploying Azure resources**.
Create both credentials for your actual GitHub owner and repository, including
your fork's owner if applicable:

| Entity type | Value | Default GitHub subject |
| --- | --- | --- |
| Branch | `main` | `repo:<owner>/<repo>:ref:refs/heads/main` |
| Environment | `production` | `repo:<owner>/<repo>:environment:production` |

Use issuer `https://token.actions.githubusercontent.com` and audience
`api://AzureADTokenExchange`. The provision/build jobs use the branch credential;
the deploy job uses the environment credential. Configuring only one is
insufficient. These subjects assume GitHub's default subject format; customized
OIDC subjects must match your repository's actual token claims. See
[Microsoft's federation guide](https://learn.microsoft.com/entra/workload-id/workload-identity-federation-create-trust).

In GitHub **Settings > Environments**, create `production`, restrict deployments
to `main`, and configure required reviewers where supported. This approval gates
the final deploy job only; registry provisioning and image builds run first.

### 3. Configure repository settings

Under **Settings > Secrets and variables > Actions**, set the following at
**repository scope**. Provision/build do not use the `production` environment,
so Azure login settings stored only there will not reach those jobs.

| Type | Name | Value |
| --- | --- | --- |
| Secret | `AZURE_CLIENT_ID` | Deployment registration's client ID |
| Secret | `AZURE_TENANT_ID` | Tenant ID shared by deployment and web sign-in |
| Secret | `AZURE_SUBSCRIPTION_ID` | Application subscription ID |
| Secret | `ENTRA_AUTH_CLIENT_SECRET` | Web sign-in registration's current secret value |
| Variable | `ENTRA_AUTH_CLIENT_ID` | Web sign-in registration's client ID |
| Variable | `AZURE_RESOURCE_GROUP` | Existing application resource group |
| Variable | `AZURE_LOCATION` | Resource group's region, for example `eastus2` |
| Optional variable | `AZURE_FOUNDRY_ENDPOINT` | Foundry resource endpoint |
| Optional variable | `AZURE_FOUNDRY_MODEL` | Existing deployment name |
| Optional variable | `AZURE_FOUNDRY_RESOURCE_ID` | Full account resource ID for model discovery |

The deployment identity, web sign-in registration, and runtime managed identity
are three different identities. Visitors need Entra access, not their own Azure
subscription. Their AI requests use the host's configured model and billing.

### 4. Run and verify

In GitHub **Actions > deploy > Run workflow**, select `main`. Approve the
`production` deployment if configured. The summary provides the web URL and
callback. Repeat Steps 5 and 6 above as needed.

Later pushes to `main` affecting `apps`, `packages`, `infra`, or the deployment
workflow trigger deployment automatically. Documentation-only changes do not.
Do not dispatch from another branch unless its OIDC trust and environment
policy are explicitly configured.

## Updates and troubleshooting

For a manual update, repeat Steps 1 through 4 with a new image tag and the same
infrastructure and sign-in settings, then repeat the verification checks. Retain
previous known-good image tags: redeploying one can roll back application code,
but does not undo infrastructure changes. Rotate the web sign-in secret before
expiry and redeploy using its new value (update the GitHub secret for automation).

| Symptom | First checks |
| --- | --- |
| Resource-group creation or provider registration denied | Have a subscription administrator complete the bootstrap in Part 1 |
| Role assignment denied | Caller needs role-assignment authority at the target scope, not just Contributor |
| ACR build denied or unavailable | Check deployment permissions and regional/subscription availability of ACR Tasks |
| Image pull failure | Both images must exist under the exact tag; check the identity's `AcrPull` role and allow for role propagation |
| `AADSTS70021` / no matching federated credential | Check branch versus environment subject, owner/repo, tenant, and audience |
| `AADSTS50011` / redirect mismatch | Register the exact HTTPS callback on the correct web registration |
| Sign-in token or client-secret error | Check ID tokens setting, tenant/client ID, and secret value and expiry |
| An approved user cannot sign in | Check enterprise application assignment, guest acceptance, consent, and Conditional Access |
| Web loads but API returns redirects, 502, or 504 | Inspect nginx upstream and forwarded Host routing to internal Container Apps ingress; verify HTTP/HTTPS behavior before widening access |
| AI is unavailable or returns 401/403 | Check deployed Foundry parameters, runtime identity roles, model availability, and account network restrictions; local `.env` is irrelevant |

Use **Container Apps > Log stream** and **Revisions** in the portal to inspect
both `aar-web` and `aar-api`. The API can scale to zero, so allow for a cold start.
Never resolve an access failure by disabling Entra or making the API public.