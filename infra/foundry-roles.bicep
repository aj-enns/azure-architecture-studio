targetScope = 'resourceGroup'

// Optional: automates the keyless Foundry role grants that main.bicep can't do
// itself (the Foundry account is bring-your-own and usually lives in a different
// resource group). Deploy this INTO the Foundry account's resource group:
//
//   az deployment group create -g <foundry-rg> -f infra/foundry-roles.bicep \
//     -p foundryAccountName=<account> principalId=<identity-principal-id>
//
// principalId is registry.bicep's identityPrincipalId output. The caller needs
// Owner or User Access Administrator on the Foundry resource group.

@description('Name of the existing Microsoft.CognitiveServices/accounts (Foundry) resource.')
param foundryAccountName string

@description('Principal (object) id of the user-assigned identity (registry.bicep identityPrincipalId output).')
param principalId string

// Built-in roles: inference + deployment discovery (ADR-0015).
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7' // Reader

resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: foundryAccountName
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, principalId, openAiUserRoleId)
  scope: foundry
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

resource cognitiveServicesUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, principalId, cognitiveServicesUserRoleId)
  scope: foundry
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

resource reader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, principalId, readerRoleId)
  scope: foundry
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRoleId)
    principalType: 'ServicePrincipal'
  }
}
