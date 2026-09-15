targetScope = 'resourceGroup'

// App resources: Log Analytics, a Container Apps environment, and the internal
// API + external web apps. Runs AFTER registry.bicep (which creates the ACR and
// the pull identity) and AFTER the images are pushed, so the apps start on a
// real image. Web reverse-proxies the internal API (ADR-0009); the upstream is
// injected as API_UPSTREAM so nginx can reach the API by its environment name.

@description('Base name used to derive resource names.')
param name string = 'aar'

@description('Location for all resources.')
param location string = resourceGroup().location

@description('ACR login server, e.g. aaracrxxxx.azurecr.io (registry.bicep output).')
param acrLoginServer string

@description('Resource id of the user-assigned identity used to pull images and for keyless AI auth (registry.bicep output).')
param managedIdentityId string

@description('Client id of the user-assigned identity, used for keyless Foundry auth (registry.bicep output).')
param managedIdentityClientId string

@description('Container image tag to deploy (e.g. the git SHA).')
param imageTag string = 'latest'

@description('Enable repository and ARM imports. Set false for a hosted diagram-only demo; authentication is unchanged.')
param iacImportEnabled bool = true

@description('Microsoft Foundry endpoint, e.g. https://<resource>.services.ai.azure.com. Leave empty to run without AI.')
param azureFoundryEndpoint string = ''

@description('Foundry model/deployment name, e.g. gpt-5-mini. Leave empty to run without AI.')
param azureFoundryModel string = ''

@description('Optional Foundry ARM resource id to enable review model discovery.')
param azureFoundryResourceId string = ''

@description('Foundry model-inference API version.')
param azureFoundryApiVersion string = '2024-05-01-preview'

@description('Enable Microsoft Entra ID authentication on the public web app. Disable only when another trusted edge provides authentication.')
param enableEntraAuth bool = true

@description('Microsoft Entra tenant id used to authenticate web users.')
param entraTenantId string = ''

@description('Client id of the app registration used by Container Apps authentication.')
param entraClientId string = ''

@secure()
@description('Client secret of the app registration used by Container Apps authentication.')
param entraClientSecret string = ''

var tags = {
  application: 'azure-architecture-review'
  managedBy: 'bicep'
}

var uniqueSuffix = uniqueString(resourceGroup().id)

var apiAppName = '${name}-api'
var webAppName = '${name}-web'
var apiImage = '${acrLoginServer}/aar-api:${imageTag}'
var webImage = '${acrLoginServer}/aar-web:${imageTag}'
var entraClientSecretName = 'entra-client-secret'

// Registry reference shared by both apps; images are pulled with the identity.
var registries = [
  {
    server: acrLoginServer
    identity: managedIdentityId
  }
]

var appIdentity = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${managedIdentityId}': {}
  }
}

// ---- Observability ----------------------------------------------------------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs-${uniqueSuffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---- Container Apps environment ---------------------------------------------
resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env-${uniqueSuffix}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ---- API container app (internal ingress) -----------------------------------
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  tags: tags
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'http'
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          // Keyless Foundry auth: DefaultAzureCredential uses AZURE_CLIENT_ID to
          // pick the user-assigned identity (ADR-0011). Grant that identity roles
          // on the Foundry resource (see README).
          env: [
            { name: 'PORT', value: '8080' }
            { name: 'IAC_IMPORT_ENABLED', value: iacImportEnabled ? 'true' : 'false' }
            { name: 'CORS_ORIGIN', value: 'https://${webAppName}.${containerEnv.properties.defaultDomain}' }
            { name: 'AZURE_CLIENT_ID', value: managedIdentityClientId }
            { name: 'AZURE_FOUNDRY_ENDPOINT', value: azureFoundryEndpoint }
            { name: 'AZURE_FOUNDRY_MODEL', value: azureFoundryModel }
            { name: 'AZURE_FOUNDRY_RESOURCE_ID', value: azureFoundryResourceId }
            { name: 'AZURE_FOUNDRY_API_VERSION', value: azureFoundryApiVersion }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
}

// ---- Web container app (external ingress) -----------------------------------
resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  tags: tags
  identity: appIdentity
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
      }
      registries: registries
      secrets: enableEntraAuth
        ? [
            {
              name: entraClientSecretName
              value: entraClientSecret
            }
          ]
        : []
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          // nginx reverse-proxies /api and /healthz to the internal API app,
          // reachable by name inside the Container Apps environment (ADR-0009).
          env: [
            { name: 'API_UPSTREAM', value: 'http://${apiApp.name}' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// Authentication runs in the Container Apps platform before requests reach
// nginx. The browser receives a secure session cookie after Entra sign-in.
resource webAuth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (enableEntraAuth) {
  name: 'current'
  parent: webApp
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureActiveDirectory'
    }
    httpSettings: {
      requireHttps: true
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: entraClientSecretName
          openIdIssuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [
            entraClientId
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
    }
  }
}

output webFqdn string = webApp.properties.configuration.ingress.fqdn
output apiInternalName string = apiApp.name
output entraAuthEnabled bool = enableEntraAuth
output entraRedirectUri string = 'https://${webApp.properties.configuration.ingress.fqdn}/.auth/login/aad/callback'
