import { describe, expect, it } from 'vitest';
import {
  isScannableIacPath,
  parseBicepResources,
  parseTerraformResources,
  scanRepoFiles,
} from './importIac.js';

describe('parseBicepResources', () => {
  const bicep = `
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'aas-logs'
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'aas-env'
  properties: {
    appLogsConfiguration: { logAnalyticsConfiguration: { customerId: logAnalytics.properties.customerId } }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'aas-api'
  properties: { managedEnvironmentId: env.id }
}
`;

  it('extracts resources with ARM types', () => {
    const resources = parseBicepResources(bicep);
    expect(resources.map((r) => r.type)).toEqual([
      'Microsoft.OperationalInsights/workspaces',
      'Microsoft.App/managedEnvironments',
      'Microsoft.App/containerApps',
    ]);
    expect(resources.map((r) => r.name)).toEqual(['aas-logs', 'aas-env', 'aas-api']);
  });

  it('infers dependency edges from symbolic references', () => {
    const resources = parseBicepResources(bicep);
    const api = resources.find((r) => r.key === 'api')!;
    const env = resources.find((r) => r.key === 'env')!;
    expect(api.dependsOn).toContain('env');
    expect(env.dependsOn).toContain('logAnalytics');
  });

  it('retains existing Foundry resource references', () => {
    const resources = parseBicepResources(`
resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: foundryAccountName
}
`);

    expect(resources).toEqual([
      expect.objectContaining({
        key: 'foundry',
        name: 'foundryAccountName',
        existing: true,
        serviceId: 'ai-foundry',
      }),
    ]);
  });

  it('preserves dynamic top-level names instead of nested SKU names', () => {
    const resources = parseBicepResources(`
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '\${name}-logs-\${uniqueSuffix}'
  properties: {
    sku: { name: 'PerGB2018' }
  }
}
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  sku: { name: 'Basic' }
}
`);

    expect(resources.map((resource) => resource.name)).toEqual([
      '${name}-logs-${uniqueSuffix}',
      'acrName',
    ]);
  });
});

describe('parseTerraformResources', () => {
  const tf = `
resource "azurerm_log_analytics_workspace" "logs" {
  name = "aas-logs"
}

resource "azurerm_container_app_environment" "env" {
  name                       = "aas-env"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
}

resource "azurerm_linux_function_app" "fn" {
  name = "aas-fn"
}

resource "random_string" "suffix" {
  length = 6
}
`;

  it('maps azurerm types to ARM types and ignores non-azure resources', () => {
    const resources = parseTerraformResources(tf);
    expect(resources.map((r) => r.type)).toEqual([
      'Microsoft.OperationalInsights/workspaces',
      'Microsoft.App/managedEnvironments',
      'Microsoft.Web/sites',
    ]);
  });

  it('marks function apps with kind so they resolve to Azure Functions', () => {
    const fn = parseTerraformResources(tf).find((r) => r.name === 'aas-fn')!;
    expect(fn.kind).toBe('functionapp');
  });

  it('infers edges from interpolated references', () => {
    const env = parseTerraformResources(tf).find((r) => r.name === 'aas-env')!;
    expect(env.dependsOn).toContain('azurerm_log_analytics_workspace.logs');
  });
});

describe('scanRepoFiles', () => {
  it('merges Bicep, Terraform, and ARM files into one diagram', () => {
    const diagram = scanRepoFiles([
      {
        path: 'infra/main.bicep',
        content: `resource api 'Microsoft.App/containerApps@2024-03-01' = { name: 'a' }`,
      },
      { path: 'tf/main.tf', content: `resource "azurerm_container_registry" "acr" { name = "r" }` },
      {
        path: 'arm/azuredeploy.json',
        content: JSON.stringify({
          $schema: 'https://schema.management.azure.com/deploymentTemplate.json#',
          resources: [{ type: 'Microsoft.KeyVault/vaults', name: 'kv' }],
        }),
      },
      { path: 'package.json', content: JSON.stringify({ name: 'not-arm', resources: 'nope' }) },
    ]);

    const serviceIds = diagram.nodes.map((n) => n.serviceId).sort();
    expect(serviceIds).toEqual(['container-apps', 'container-registry', 'key-vault']);
  });

  it('returns an empty diagram when no IaC is present', () => {
    expect(scanRepoFiles([{ path: 'README.md', content: '# hi' }]).nodes).toHaveLength(0);
  });

  it('groups deployed Bicep resources while leaving existing Foundry external', () => {
    const diagram = scanRepoFiles([
      {
        path: 'infra/main.bicep',
        content: `
targetScope = 'resourceGroup'
resource api 'Microsoft.App/containerApps@2024-03-01' = { name: 'api' }
`,
      },
      {
        path: 'infra/foundry-roles.bicep',
        content: `
targetScope = 'resourceGroup'
resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: foundryAccountName
}
`,
      },
    ]);

    const group = diagram.groups.find((candidate) => candidate.kind === 'resourceGroup');
    const api = diagram.nodes.find((node) => node.serviceId === 'container-apps');
    const foundry = diagram.nodes.find((node) => node.serviceId === 'ai-foundry');
    expect(diagram.groups).toHaveLength(1);
    expect(group?.label).toBe('Deployment resource group');
    expect(api?.parentId).toBe(group?.id);
    expect(foundry).toMatchObject({ label: 'foundryAccountName', properties: { existing: true } });
    expect(foundry?.parentId).toBeUndefined();
  });
});

describe('isScannableIacPath', () => {
  it('keeps nested IaC while excluding repository JSON metadata', () => {
    expect(isScannableIacPath('infra/main.bicep')).toBe(true);
    expect(isScannableIacPath('infra/main.tf')).toBe(true);
    expect(isScannableIacPath('infra/azuredeploy.json')).toBe(true);
    expect(isScannableIacPath('templates/app.json')).toBe(true);
    expect(isScannableIacPath('node_modules/package/package.json')).toBe(false);
    expect(isScannableIacPath('pnpm-lock.json')).toBe(false);
  });

  it('does not let package metadata exhaust the repository upload limit', () => {
    const paths = [
      ...Array.from({ length: 600 }, (_, index) => `node_modules/package-${index}/package.json`),
      'infra/main.bicep',
    ];
    const uploaded = paths.filter(isScannableIacPath).slice(0, 500);

    expect(uploaded).toEqual(['infra/main.bicep']);
  });
});
