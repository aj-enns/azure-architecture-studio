import { describe, expect, it } from 'vitest';
import { emptyDiagram, type Diagram } from './schema.js';
import { generateIacBundle } from './iac.js';

function sampleDiagram(): Diagram {
  const diagram = emptyDiagram('Contoso Review');
  diagram.metadata.region = 'canadacentral';
  diagram.nodes = [
    {
      id: 'storage-1',
      serviceId: 'storage-account',
      label: 'Audit Storage',
      position: { x: 0, y: 0 },
      properties: { sku: 'Standard_LRS' },
    },
    {
      id: 'vault-1',
      serviceId: 'key-vault',
      label: 'Shared Secrets',
      position: { x: 200, y: 0 },
      properties: {},
    },
    {
      id: 'directory-1',
      serviceId: 'entra-id',
      label: 'Workforce tenant',
      position: { x: 400, y: 0 },
      properties: {},
    },
  ];
  return diagram;
}

describe('IaC generation', () => {
  it('generates a deterministic Bicep bundle with catalog provenance', () => {
    const first = generateIacBundle(sampleDiagram(), 'bicep');
    const second = generateIacBundle(sampleDiagram(), 'bicep');

    expect(second).toEqual(first);
    expect(first.files.map((file) => file.path)).toEqual(['main.bicep', 'README.md']);
    expect(first.files[0]?.content).toContain("targetScope = 'resourceGroup'");
    expect(first.files[0]?.content).toContain('Microsoft.Storage/storageAccounts');
    expect(first.files[0]?.content).toContain('Microsoft.KeyVault/vaults');
    expect(first.files[0]?.content).toContain('br/public:avm/res/storage/storage-account');
    expect(first.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'directory-1', severity: 'info' }),
      ]),
    );
  });

  it('generates Terraform files backed by the AzAPI provider', () => {
    const bundle = generateIacBundle(sampleDiagram(), 'terraform');

    expect(bundle.files.map((file) => file.path)).toEqual([
      'versions.tf',
      'variables.tf',
      'main.tf',
      'outputs.tf',
      'README.md',
    ]);
    expect(bundle.files.find((file) => file.path === 'versions.tf')?.content).toContain(
      'Azure/azapi',
    );
    expect(bundle.files.find((file) => file.path === 'main.tf')?.content).toContain(
      'resource "azapi_resource" "audit_storage"',
    );
  });

  it('keeps an empty diagram exportable', () => {
    const bundle = generateIacBundle(emptyDiagram('Empty'), 'bicep');

    expect(bundle.files).toHaveLength(2);
    expect(bundle.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('no resources') }),
    ]);
  });

  it('links Application Insights to a generated Log Analytics workspace', () => {
    const diagram = emptyDiagram('Observability');
    diagram.nodes = [
      { id: 'insights', serviceId: 'app-insights', label: 'Insights', position: { x: 0, y: 0 }, properties: {} },
      { id: 'logs', serviceId: 'log-analytics', label: 'Logs', position: { x: 0, y: 100 }, properties: {} },
    ];

    const bicep = generateIacBundle(diagram, 'bicep').files[0]?.content;
    const terraform = generateIacBundle(diagram, 'terraform').files.find((file) => file.path === 'main.tf')?.content;

    expect(bicep).toContain('WorkspaceResourceId: logs.id');
    expect(terraform).toContain('WorkspaceResourceId = azapi_resource.logs.id');
  });

  it('composes the reference three-tier architecture in both targets', () => {
    const diagram = emptyDiagram('three-tier-web-app');
    diagram.groups = [
      { id: 'rg', kind: 'resourceGroup', label: 'rg-webapp', position: { x: 0, y: 0 }, size: { width: 1000, height: 800 }, collapsed: false, properties: {} },
      { id: 'vnet', kind: 'vnet', label: 'webapp-vnet', position: { x: 0, y: 0 }, size: { width: 700, height: 700 }, parentId: 'rg', collapsed: false, properties: { addressSpace: '10.0.0.0/16' } },
      { id: 'agw-subnet', kind: 'subnet', label: 'agw-subnet', position: { x: 0, y: 0 }, size: { width: 200, height: 140 }, parentId: 'vnet', collapsed: false, properties: { addressPrefix: '10.0.0.0/24' } },
      { id: 'app-subnet', kind: 'subnet', label: 'app-subnet', position: { x: 0, y: 0 }, size: { width: 200, height: 140 }, parentId: 'vnet', collapsed: false, properties: { addressPrefix: '10.0.1.0/24' } },
      { id: 'pe-subnet', kind: 'subnet', label: 'pe-subnet', position: { x: 0, y: 0 }, size: { width: 200, height: 140 }, parentId: 'vnet', collapsed: false, properties: { addressPrefix: '10.0.2.0/24' } },
    ];
    diagram.nodes = [
      { id: 'gateway', serviceId: 'application-gateway', label: 'app-gateway-waf', position: { x: 0, y: 0 }, parentId: 'agw-subnet', properties: { sku: 'WAF_v2', capacity: 2 } },
      { id: 'plan', serviceId: 'app-service-plan', label: 'appservice-plan', position: { x: 0, y: 0 }, parentId: 'rg', properties: { sku: 'P1v3', os: 'Linux' } },
      { id: 'app', serviceId: 'app-service', label: 'web-app', position: { x: 0, y: 0 }, parentId: 'app-subnet', properties: { os: 'Linux' } },
      { id: 'sql', serviceId: 'sql-database', label: 'primary-sql', position: { x: 0, y: 0 }, parentId: 'rg', properties: { tier: 'GeneralPurpose', compute: 'Serverless' } },
      { id: 'redis', serviceId: 'redis', label: 'redis-cache', position: { x: 0, y: 0 }, parentId: 'rg', properties: { sku: 'Balanced_B1' } },
      { id: 'pe-sql', serviceId: 'private-endpoint', label: 'pe-sql', position: { x: 0, y: 0 }, parentId: 'pe-subnet', properties: {} },
      { id: 'pe-redis', serviceId: 'private-endpoint', label: 'pe-redis', position: { x: 0, y: 0 }, parentId: 'pe-subnet', properties: {} },
      { id: 'vault', serviceId: 'key-vault', label: 'key-vault', position: { x: 0, y: 0 }, parentId: 'rg', properties: {} },
      { id: 'identity', serviceId: 'managed-identity', label: 'web-managed-identity', position: { x: 0, y: 0 }, parentId: 'rg', properties: {} },
      { id: 'entra', serviceId: 'entra-id', label: 'entra-tenant', position: { x: 0, y: 0 }, parentId: 'rg', properties: {} },
      { id: 'insights', serviceId: 'app-insights', label: 'app-insights', position: { x: 0, y: 0 }, parentId: 'rg', properties: {} },
      { id: 'logs', serviceId: 'log-analytics', label: 'log-analytics', position: { x: 0, y: 0 }, parentId: 'rg', properties: {} },
    ];
    diagram.edges = [
      { id: 'gateway-app', source: 'gateway', target: 'app', label: 'HTTPS traffic' },
      { id: 'app-plan', source: 'app', target: 'plan', label: 'hosted on' },
      { id: 'app-identity', source: 'app', target: 'identity', label: 'uses managed identity' },
      { id: 'pe-sql-target', source: 'pe-sql', target: 'sql', label: 'private link' },
      { id: 'pe-redis-target', source: 'pe-redis', target: 'redis', label: 'private link' },
    ];

    const bicepBundle = generateIacBundle(diagram, 'bicep');
    const terraformBundle = generateIacBundle(diagram, 'terraform');
    const bicep = bicepBundle.files[0]?.content ?? '';
    const terraform = terraformBundle.files.find((file) => file.path === 'main.tf')?.content ?? '';

    expect(bicepBundle.generatedResourceCount).toBe(11);
    expect(bicepBundle.diagnostics).toEqual([
      expect.objectContaining({ serviceId: 'entra-id', severity: 'info' }),
    ]);
    expect(bicep).toContain("resource webapp_vnet 'Microsoft.Network/virtualNetworks@2024-05-01'");
    expect(bicep).toContain("name: 'app-subnet'");
    expect(bicep).toContain("resource appservice_plan 'Microsoft.Web/serverfarms@2024-04-01'");
    expect(bicep).toContain('serverFarmId: appservice_plan.id');
    expect(bicep).toContain('virtualNetworkSubnetId: resourceId(');
    expect(bicep).toContain('@secure()\nparam primarySqlAdministratorPassword string');
    expect(bicep).toContain("resource primary_sql_server 'Microsoft.Sql/servers@2023-08-01'");
    expect(bicep).toContain("resource redis_cache_database 'Microsoft.Cache/redisEnterprise/databases@2024-10-01'");
    expect(bicep).toContain('privateLinkServiceConnections:');
    expect(bicep).toContain("resource app_gateway_waf 'Microsoft.Network/applicationGateways@2024-05-01'");

    expect(terraformBundle.generatedResourceCount).toBe(11);
    expect(terraform).toContain('resource "azapi_resource" "webapp_vnet"');
    expect(terraform).toContain('resource "azapi_resource" "app_subnet"');
    expect(terraform).toContain('serverFarmId = azapi_resource.appservice_plan.id');
    expect(terraform).toContain('resource "azapi_resource" "primary_sql_server"');
    expect(terraform).toContain('resource "azapi_resource" "redis_cache_database"');
    expect(terraform).toContain('resource "azapi_resource" "pe_sql"');
    expect(terraform).toContain('resource "azapi_resource" "app_gateway_waf"');
  });

  it('generates standalone bodies for the extended catalog coverage', () => {
    const services = [
      'aks',
      'container-apps',
      'static-web-app',
      'api-management',
      'postgresql',
      'load-balancer',
      'front-door',
      'azure-openai',
      'ai-search',
      'event-hubs',
      'data-explorer',
      'service-bus',
    ] as const;
    const diagram = emptyDiagram('extended-coverage');
    diagram.nodes = services.map((serviceId, index) => ({
      id: `n-${serviceId}`,
      serviceId,
      label: serviceId,
      position: { x: index * 40, y: 0 },
      properties: {},
    }));

    const bicep = generateIacBundle(diagram, 'bicep');
    const terraform = generateIacBundle(diagram, 'terraform');

    expect(bicep.generatedResourceCount).toBe(services.length);
    expect(terraform.generatedResourceCount).toBe(services.length);
    expect(bicep.diagnostics).toEqual([]);
    expect(terraform.diagnostics).toEqual([]);

    const bicepMain = bicep.files[0]?.content ?? '';
    expect(bicepMain).toContain("'Microsoft.ContainerService/managedClusters@2024-09-01'");
    expect(bicepMain).toContain("'Microsoft.App/managedEnvironments@2024-03-01'");
    expect(bicepMain).toContain("'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01'");
    expect(bicepMain).toContain("@secure()\nparam postgresqlAdministratorPassword string");
    expect(bicepMain).toContain("'Microsoft.CognitiveServices/accounts@2024-10-01'");
    expect(bicepMain).toContain("location: 'global'");

    const terraformMain = terraform.files.find((file) => file.path === 'main.tf')?.content ?? '';
    expect(terraformMain).toContain('resource "azapi_resource" "container_apps_env"');
    expect(terraformMain).toContain('resource "azapi_resource" "load_balancer_public_ip"');
    expect(terraformMain).toContain('location  = "global"');
  });
});