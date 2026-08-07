targetScope = 'resourceGroup'

@description('Base name used to derive resource names.')
param name string = 'aar'

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Container image for the API (e.g. myregistry.azurecr.io/aar-api:latest).')
param apiImage string

@description('Container image for the web app (e.g. myregistry.azurecr.io/aar-web:latest).')
param webImage string

@description('Azure OpenAI endpoint (bring-your-own). Leave empty to run without AI.')
param azureOpenAiEndpoint string = ''

@description('Azure OpenAI deployment name. Leave empty to run without AI.')
param azureOpenAiDeployment string = ''

@description('Azure OpenAI API key (bring-your-own). Stored as a Container App secret.')
@secure()
param azureOpenAiApiKey string = ''

var tags = {
  application: 'azure-architecture-review'
  managedBy: 'bicep'
}

var uniqueSuffix = uniqueString(resourceGroup().id)

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
  name: '${name}-api'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'http'
      }
      secrets: empty(azureOpenAiApiKey)
        ? []
        : [
            {
              name: 'azure-openai-api-key'
              value: azureOpenAiApiKey
            }
          ]
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
          env: concat(
            [
              { name: 'PORT', value: '8080' }
              { name: 'CORS_ORIGIN', value: 'https://${name}-web.${containerEnv.properties.defaultDomain}' }
              { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
              { name: 'AZURE_OPENAI_DEPLOYMENT', value: azureOpenAiDeployment }
            ],
            empty(azureOpenAiApiKey)
              ? []
              : [ { name: 'AZURE_OPENAI_API_KEY', secretRef: 'azure-openai-api-key' } ]
          )
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
  name: '${name}-web'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
      }
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
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output webFqdn string = webApp.properties.configuration.ingress.fqdn
output apiFqdn string = apiApp.properties.configuration.ingress.fqdn
