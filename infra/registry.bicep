targetScope = 'resourceGroup'

// Registry + identity are deployed BEFORE the app images exist, so the pipeline
// can push to ACR and the container apps can pull from it with a managed
// identity (no admin credentials). Kept separate from main.bicep to break the
// image chicken-and-egg: provision registry -> build/push -> deploy apps.

@description('Base name used to derive resource names.')
param name string = 'aar'

@description('Location for all resources.')
param location string = resourceGroup().location

var tags = {
  application: 'azure-architecture-review'
  managedBy: 'bicep'
}

var uniqueSuffix = uniqueString(resourceGroup().id)

// ACR names are globally unique, alphanumeric, and lowercase.
var acrName = toLower(replace('${name}acr${uniqueSuffix}', '-', ''))

// Built-in AcrPull role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// User-assigned identity the container apps use to pull images from ACR.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-id-${uniqueSuffix}'
  location: location
  tags: tags
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalType: 'ServicePrincipal'
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output identityId string = identity.id
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
