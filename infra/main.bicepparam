using './main.bicep'

// Copy this file, fill in your image references, and deploy with:
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam

param name = 'aar'
param apiImage = '<registry>.azurecr.io/aar-api:latest'
param webImage = '<registry>.azurecr.io/aar-web:latest'

// Bring-your-own Azure OpenAI (optional). Leave blank to run without AI.
param azureOpenAiEndpoint = ''
param azureOpenAiDeployment = ''
param azureOpenAiApiKey = ''
