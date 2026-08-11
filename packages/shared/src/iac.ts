import { getServiceDefinition, type ServiceDefinition } from './catalog.js';
import type { Diagram, DiagramGroup, DiagramNode } from './schema.js';

export type IacTarget = 'bicep' | 'terraform';
export type IacDiagnosticSeverity = 'info' | 'warning';

export interface IacFile {
  path: string;
  content: string;
  language: 'bicep' | 'hcl' | 'markdown';
}

export interface IacDiagnostic {
  severity: IacDiagnosticSeverity;
  message: string;
  nodeId?: string;
  serviceId?: string;
}

export interface IacBundle {
  target: IacTarget;
  files: IacFile[];
  diagnostics: IacDiagnostic[];
  generatedResourceCount: number;
}

interface ResourceContext {
  node: DiagramNode;
  service: ServiceDefinition;
  symbol: string;
  parameter: string;
  defaultName: string;
}

const SUPPORTED_SERVICE_IDS = new Set([
  'storage-account',
  'key-vault',
  'managed-identity',
  'vnet',
  'log-analytics',
  'app-insights',
  'container-registry',
  'cosmos-db',
  'app-service-plan',
  'app-service',
  'sql-database',
  'redis',
  'private-endpoint',
  'application-gateway',
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
]);

const API_VERSION: Record<string, string> = {
  'storage-account': '2023-05-01',
  'key-vault': '2023-07-01',
  'managed-identity': '2023-01-31',
  vnet: '2024-05-01',
  'log-analytics': '2023-09-01',
  'app-insights': '2020-02-02',
  'container-registry': '2023-07-01',
  'cosmos-db': '2024-05-15',
  'app-service-plan': '2024-04-01',
  'app-service': '2024-04-01',
  'sql-database': '2023-08-01',
  redis: '2024-10-01',
  'private-endpoint': '2024-05-01',
  'application-gateway': '2024-05-01',
  aks: '2024-09-01',
  'container-apps': '2024-03-01',
  'static-web-app': '2024-04-01',
  'api-management': '2024-05-01',
  postgresql: '2024-08-01',
  'load-balancer': '2024-05-01',
  'front-door': '2024-09-01',
  'azure-openai': '2024-10-01',
  'ai-search': '2023-11-01',
  'event-hubs': '2024-01-01',
  'data-explorer': '2024-04-13',
  'service-bus': '2024-01-01',
};

/** Services whose AzAPI embedded schema is incomplete and needs relaxed body validation. */
const AZAPI_SCHEMA_OVERRIDE = new Set<string>(['log-analytics']);

/** Generate review-ready IaC scaffolding without model calls or network access. */
export function generateIacBundle(diagram: Diagram, target: IacTarget): IacBundle {
  const { resources, diagnostics } = collectResources(diagram);
  if (diagram.nodes.length === 0) {
    diagnostics.push({
      severity: 'warning',
      message: 'The diagram contains no resources; the generated files only contain deployment scaffolding.',
    });
  }

  const files = target === 'bicep'
    ? generateBicepFiles(diagram, resources, diagnostics)
    : generateTerraformFiles(diagram, resources, diagnostics);

  return {
    target,
    files,
    diagnostics,
    generatedResourceCount: resources.length,
  };
}

function collectResources(diagram: Diagram): {
  resources: ResourceContext[];
  diagnostics: IacDiagnostic[];
} {
  const diagnostics: IacDiagnostic[] = [];
  const usedSymbols = new Set<string>();
  const usedNames = new Set<string>();
  const resources: ResourceContext[] = [];

  for (const node of diagram.nodes) {
    const service = getServiceDefinition(node.serviceId);
    if (!service) {
      diagnostics.push({
        severity: 'warning',
        message: `Unknown catalog service "${node.serviceId}" was not generated.`,
        nodeId: node.id,
        serviceId: node.serviceId,
      });
      continue;
    }
    if (!service.iac) {
      diagnostics.push({
        severity: 'info',
        message: `${service.name} is conceptual or tenant-scoped and is not emitted as a resource.`,
        nodeId: node.id,
        serviceId: node.serviceId,
      });
      continue;
    }
    if (!SUPPORTED_SERVICE_IDS.has(node.serviceId)) {
      diagnostics.push({
        severity: 'warning',
        message: `${service.name} needs topology-specific required inputs before it can be generated safely.`,
        nodeId: node.id,
        serviceId: node.serviceId,
      });
      continue;
    }
    const dependencyIssue = validateDependencies(diagram, node);
    if (dependencyIssue) {
      diagnostics.push({
        severity: 'warning',
        message: dependencyIssue,
        nodeId: node.id,
        serviceId: node.serviceId,
      });
      continue;
    }

    const symbol = uniqueIdentifier(node.label || service.name, usedSymbols);
    const defaultName = uniqueResourceName(diagram.metadata.name, node, usedNames);
    resources.push({
      node,
      service,
      symbol,
      parameter: `${camelCase(symbol)}Name`,
      defaultName,
    });
  }

  return { resources, diagnostics };
}

function validateDependencies(diagram: Diagram, node: DiagramNode): string | null {
  if (node.serviceId === 'app-service' && !findRelatedNode(diagram, node, 'app-service-plan')) {
    return 'App Service needs a connected App Service Plan before it can be generated safely.';
  }
  if (node.serviceId === 'application-gateway') {
    if (!subnetForNode(diagram, node)) return 'Application Gateway must be placed in a subnet group.';
    if (!findRelatedNode(diagram, node, 'app-service')) {
      return 'Application Gateway needs a connected App Service backend before it can be generated safely.';
    }
  }
  if (node.serviceId === 'private-endpoint') {
    if (!subnetForNode(diagram, node)) return 'Private Endpoint must be placed in a subnet group.';
    const target = findRelatedNode(diagram, node);
    if (!target || !privateLinkGroupId(target.serviceId)) {
      return 'Private Endpoint needs a connected, supported private-link target.';
    }
  }
  return null;
}

function findRelatedNode(
  diagram: Diagram,
  node: DiagramNode,
  serviceId?: string,
): DiagramNode | undefined {
  for (const edge of diagram.edges) {
    const otherId = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
    if (!otherId) continue;
    const related = diagram.nodes.find((candidate) => candidate.id === otherId);
    if (related && (!serviceId || related.serviceId === serviceId)) return related;
  }
  return undefined;
}

function findResource(resources: ResourceContext[], node?: DiagramNode): ResourceContext | undefined {
  return node ? resources.find((resource) => resource.node.id === node.id) : undefined;
}

function subnetForNode(
  diagram: Diagram,
  node: DiagramNode,
): { subnet: DiagramGroup; vnet: DiagramGroup } | null {
  let group = node.parentId ? diagram.groups.find((candidate) => candidate.id === node.parentId) : undefined;
  while (group && group.kind !== 'subnet') {
    group = group.parentId ? diagram.groups.find((candidate) => candidate.id === group?.parentId) : undefined;
  }
  if (!group) return null;
  const subnet = group;
  let parent = subnet.parentId ? diagram.groups.find((candidate) => candidate.id === subnet.parentId) : undefined;
  while (parent && parent.kind !== 'vnet') {
    parent = parent.parentId ? diagram.groups.find((candidate) => candidate.id === parent?.parentId) : undefined;
  }
  return parent ? { subnet, vnet: parent } : null;
}

function subnetGroups(diagram: Diagram, vnet: DiagramGroup): DiagramGroup[] {
  return diagram.groups.filter((group) => group.kind === 'subnet' && group.parentId === vnet.id);
}

function groupContainsNode(diagram: Diagram, group: DiagramGroup, serviceId: string): boolean {
  return diagram.nodes.some((node) => {
    if (node.serviceId !== serviceId) return false;
    let parentId = node.parentId;
    while (parentId) {
      if (parentId === group.id) return true;
      parentId = diagram.groups.find((candidate) => candidate.id === parentId)?.parentId;
    }
    return false;
  });
}

function topologySymbol(group: DiagramGroup): string {
  return slugify(group.label || group.id).replace(/-/g, '_').replace(/^([0-9])/, 'network_$1');
}

function groupPropertyString(group: DiagramGroup, key: string, fallback: string): string {
  const value = group.properties[key];
  return typeof value === 'string' && value.trim() ? value.replace(/['"\n\r]/g, '') : fallback;
}

function privateLinkGroupId(serviceId: string): string | null {
  const groups: Record<string, string> = {
    'sql-database': 'sqlServer',
    redis: 'redisEnterprise',
    'app-service': 'sites',
    'key-vault': 'vault',
    'storage-account': 'blob',
    'cosmos-db': 'Sql',
  };
  return groups[serviceId] ?? null;
}

function renderBicepParameters(resources: ResourceContext[]): string {
  return resources.flatMap((resource) => {
    const lines = [`param ${resource.parameter} string = '${escapeBicep(resource.defaultName)}'`];
    if (resource.node.serviceId === 'sql-database') {
      lines.push(
        `param ${camelCase(resource.symbol)}ServerName string = '${escapeBicep(`${resource.defaultName}-server`.slice(0, 63))}'`,
        `param ${camelCase(resource.symbol)}AdministratorLogin string = 'sqladminuser'`,
        `@secure()\nparam ${camelCase(resource.symbol)}AdministratorPassword string`,
      );
    }
    if (resource.node.serviceId === 'application-gateway') {
      lines.push(
        `@secure()\nparam ${camelCase(resource.symbol)}SslCertificateData string`,
        `@secure()\nparam ${camelCase(resource.symbol)}SslCertificatePassword string`,
      );
    }
    if (resource.node.serviceId === 'postgresql') {
      lines.push(
        `param ${camelCase(resource.symbol)}AdministratorLogin string = 'pgadminuser'`,
        `@secure()\nparam ${camelCase(resource.symbol)}AdministratorPassword string`,
      );
    }
    if (resource.node.serviceId === 'api-management') {
      lines.push(
        `param ${camelCase(resource.symbol)}PublisherEmail string = 'admin@example.com'`,
        `param ${camelCase(resource.symbol)}PublisherName string = 'Contoso'`,
      );
    }
    return lines;
  }).join('\n');
}

function renderBicepNetworks(diagram: Diagram): string {
  return diagram.groups.filter((group) => group.kind === 'vnet').map((vnet) => {
    const subnets = subnetGroups(diagram, vnet).map((subnet, index) => {
      const appDelegation = groupContainsNode(diagram, subnet, 'app-service')
        ? `\n        delegations: [{\n          name: 'app-service-delegation'\n          properties: { serviceName: 'Microsoft.Web/serverFarms' }\n        }]`
        : '';
      const privateEndpointPolicy = groupContainsNode(diagram, subnet, 'private-endpoint')
        ? `\n        privateEndpointNetworkPolicies: 'Disabled'`
        : '';
      return `    {
      name: '${escapeBicep(subnet.label || subnet.id)}'
      properties: {
        addressPrefix: '${groupPropertyString(subnet, 'addressPrefix', `10.0.${index}.0/24`)}'${appDelegation}${privateEndpointPolicy}
      }
    }`;
    }).join('\n');
    return `// Group-derived network topology
resource ${topologySymbol(vnet)} 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${escapeBicep(vnet.label || vnet.id)}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['${groupPropertyString(vnet, 'addressSpace', '10.0.0.0/16')}'] }
    subnets: [
${subnets}
    ]
  }
}`;
  }).join('\n\n');
}

function renderTerraformNameVariables(resources: ResourceContext[]): string {
  return resources.flatMap((resource) => {
    const variables = [`variable "${resource.symbol}_name" {
  type        = string
  description = "Azure resource name for ${resource.symbol}."
  default     = "${escapeHcl(resource.defaultName)}"
}`];
    if (resource.node.serviceId === 'sql-database') {
      variables.push(
        `variable "${resource.symbol}_server_name" {
  type    = string
  default = "${escapeHcl(`${resource.defaultName}-server`.slice(0, 63))}"
}`,
        `variable "${resource.symbol}_administrator_login" {
  type    = string
  default = "sqladminuser"
}`,
        `variable "${resource.symbol}_administrator_password" {
  type        = string
  sensitive   = true
  description = "Administrator password for the generated SQL logical server."
}`,
      );
    }
    if (resource.node.serviceId === 'application-gateway') {
      variables.push(
        `variable "${resource.symbol}_ssl_certificate_data" {
  type        = string
  sensitive   = true
  description = "Base64-encoded PFX certificate for the HTTPS listener."
}`,
        `variable "${resource.symbol}_ssl_certificate_password" {
  type        = string
  sensitive   = true
  description = "Password for the HTTPS listener PFX certificate."
}`,
      );
    }
    if (resource.node.serviceId === 'postgresql') {
      variables.push(
        `variable "${resource.symbol}_administrator_login" {
  type    = string
  default = "pgadminuser"
}`,
        `variable "${resource.symbol}_administrator_password" {
  type        = string
  sensitive   = true
  description = "Administrator password for the PostgreSQL flexible server."
}`,
      );
    }
    if (resource.node.serviceId === 'api-management') {
      variables.push(
        `variable "${resource.symbol}_publisher_email" {
  type    = string
  default = "admin@example.com"
}`,
        `variable "${resource.symbol}_publisher_name" {
  type    = string
  default = "Contoso"
}`,
      );
    }
    return variables;
  }).join('\n\n');
}

function renderTerraformNetworks(diagram: Diagram): string {
  return diagram.groups.filter((group) => group.kind === 'vnet').flatMap((vnet) => {
    const vnetSymbol = topologySymbol(vnet);
    const network = `# Group-derived network topology
resource "azapi_resource" "${vnetSymbol}" {
  type      = "Microsoft.Network/virtualNetworks@2024-05-01"
  name      = "${escapeHcl(vnet.label || vnet.id)}"
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    properties = { addressSpace = { addressPrefixes = ["${groupPropertyString(vnet, 'addressSpace', '10.0.0.0/16')}"] } }
  }
}`;
    const subnets = subnetGroups(diagram, vnet).map((subnet, index) => {
      const subnetSymbol = topologySymbol(subnet);
      const appDelegation = groupContainsNode(diagram, subnet, 'app-service')
        ? `\n      delegations = [{\n        name = "app-service-delegation"\n        properties = { serviceName = "Microsoft.Web/serverFarms" }\n      }]`
        : '';
      const privateEndpointPolicy = groupContainsNode(diagram, subnet, 'private-endpoint')
        ? `\n      privateEndpointNetworkPolicies = "Disabled"`
        : '';
      return `resource "azapi_resource" "${subnetSymbol}" {
  type      = "Microsoft.Network/virtualNetworks/subnets@2024-05-01"
  name      = "${escapeHcl(subnet.label || subnet.id)}"
  parent_id = azapi_resource.${vnetSymbol}.id
  body = {
    properties = {
      addressPrefix = "${groupPropertyString(subnet, 'addressPrefix', `10.0.${index}.0/24`)}"${appDelegation}${privateEndpointPolicy}
    }
  }
}`;
    });
    return [network, ...subnets];
  }).join('\n\n');
}

function generateBicepFiles(
  diagram: Diagram,
  resources: ResourceContext[],
  diagnostics: IacDiagnostic[],
): IacFile[] {
  const parameters = renderBicepParameters(resources);
  const networks = renderBicepNetworks(diagram);
  const declarations = resources.map((resource) => renderBicepResource(resource, resources, diagram)).join('\n\n');
  const outputs = resources
    .map(({ symbol }) => `output ${camelCase(symbol)}ResourceId string = ${symbol}.id`)
    .join('\n');

  const main = `${generatedHeader('//', diagram)}
targetScope = 'resourceGroup'

@description('Azure region for generated resources.')
param location string = '${escapeBicep(diagram.metadata.region || 'eastus2')}'

@description('Tags applied to generated resources.')
param tags object = {
  'architecture-review': '${escapeBicep(slugify(diagram.metadata.name))}'
  'managed-by': 'azure-architecture-review'
}
${parameters ? `\n${parameters}` : ''}
${networks ? `\n${networks}` : ''}
${declarations ? `\n${declarations}` : ''}
${outputs ? `\n${outputs}\n` : ''}`;

  return [
    { path: 'main.bicep', content: main, language: 'bicep' },
    { path: 'README.md', content: generateReadme(diagram, 'bicep', resources, diagnostics), language: 'markdown' },
  ];
}

function renderBicepResource(context: ResourceContext, resources: ResourceContext[], diagram: Diagram): string {
  const { node, service, symbol, parameter } = context;
  const type = `${service.iac?.resourceType}@${API_VERSION[node.serviceId]}`;
  const avm = service.iac?.avmModule
    ? `// AVM reference: ${service.iac.avmModule}:<pin-a-tested-version>\n`
    : '';

  switch (node.serviceId) {
    case 'storage-account':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: '${propertyString(node, 'sku', 'Standard_LRS')}' }
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    supportsHttpsTrafficOnly: true
  }
}`;
    case 'key-vault':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    sku: { family: 'A', name: '${propertyString(node, 'sku', 'standard').toLowerCase()}' }
  }
}`;
    case 'managed-identity':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
}`;
    case 'vnet':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['${propertyString(node, 'addressSpace', '10.0.0.0/16')}'] }
  }
}`;
    case 'log-analytics':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  properties: {
    retentionInDays: ${propertyNumber(node, 'retentionDays', 30)}
    publicNetworkAccessForIngestion: 'Disabled'
    publicNetworkAccessForQuery: 'Disabled'
  }
  sku: { name: 'PerGB2018' }
}`;
    case 'app-insights':
      {
        const workspace = resources.find((resource) => resource.node.serviceId === 'log-analytics');
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    DisableLocalAuth: true
    IngestionMode: '${workspace ? 'LogAnalytics' : 'ApplicationInsights'}'
${workspace ? `    WorkspaceResourceId: ${workspace.symbol}.id\n` : ''}  }
}`;
      }
    case 'container-registry':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Standard')}' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Disabled'
  }
}`;
    case 'cosmos-db':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    locations: [{ locationName: location, failoverPriority: 0 }]
    publicNetworkAccess: 'Disabled'
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
  }
}`;
    case 'app-service-plan':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  kind: '${propertyString(node, 'os', 'Linux').toLowerCase() === 'linux' ? 'linux' : 'app'}'
  sku: {
    name: '${propertyString(node, 'sku', 'P1v3')}'
    capacity: ${propertyNumber(node, 'capacity', 1)}
  }
  properties: {
    reserved: ${propertyString(node, 'os', 'Linux').toLowerCase() === 'linux'}
  }
}`;
    case 'app-service': {
      const plan = findResource(resources, findRelatedNode(diagram, node, 'app-service-plan'))!;
      const identity = findResource(resources, findRelatedNode(diagram, node, 'managed-identity'));
      const network = subnetForNode(diagram, node);
      const identityBlock = identity ? `
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '\${${identity.symbol}.id}': {} }
  }` : '';
      const subnetLine = network
        ? `\n    virtualNetworkSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', ${topologySymbol(network.vnet)}.name, '${escapeBicep(network.subnet.label || network.subnet.id)}')`
        : '';
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  kind: 'app,linux'
  properties: {
    serverFarmId: ${plan.symbol}.id
    httpsOnly: true${subnetLine}
    siteConfig: {
      linuxFxVersion: '${propertyString(node, 'runtime', 'NODE|20-lts')}'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
    }
  }${identityBlock}
}`;
    }
    case 'sql-database': {
      const prefix = camelCase(symbol);
      return `${avm}resource ${symbol}_server 'Microsoft.Sql/servers@2023-08-01' = {
  name: ${prefix}ServerName
  location: location
  tags: tags
  properties: {
    administratorLogin: ${prefix}AdministratorLogin
    administratorLoginPassword: ${prefix}AdministratorPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
}

resource ${symbol} 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: ${symbol}_server
  name: ${parameter}
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5_1'
    tier: '${propertyString(node, 'tier', 'GeneralPurpose')}'
    capacity: 1
  }
  properties: {
    autoPauseDelay: 60
    minCapacity: json('0.5')
    zoneRedundant: false
  }
}`;
    }
    case 'redis':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Balanced_B1')}' }
  properties: { minimumTlsVersion: '1.2' }
}

resource ${symbol}_database 'Microsoft.Cache/redisEnterprise/databases@2024-10-01' = {
  parent: ${symbol}
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'EnterpriseCluster'
  }
}`;
    case 'private-endpoint': {
      const targetNode = findRelatedNode(diagram, node)!;
      const target = findResource(resources, targetNode)!;
      const network = subnetForNode(diagram, node)!;
      const targetSymbol = targetNode.serviceId === 'sql-database' ? `${target.symbol}_server` : target.symbol;
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  properties: {
    subnet: {
      id: resourceId('Microsoft.Network/virtualNetworks/subnets', ${topologySymbol(network.vnet)}.name, '${escapeBicep(network.subnet.label || network.subnet.id)}')
    }
    privateLinkServiceConnections: [
      {
        name: '${escapeBicep(`${node.label || node.id}-connection`)}'
        properties: {
          privateLinkServiceId: ${targetSymbol}.id
          groupIds: ['${privateLinkGroupId(targetNode.serviceId)}']
        }
      }
    ]
  }
}`;
    }
    case 'application-gateway': {
      const backend = findResource(resources, findRelatedNode(diagram, node, 'app-service'))!;
      const network = subnetForNode(diagram, node)!;
      const prefix = camelCase(symbol);
      return `${avm}resource ${symbol}_public_ip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${escapeBicep(`${context.defaultName}-pip`.slice(0, 80))}'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: {
    name: '${propertyString(node, 'sku', 'WAF_v2')}'
    tier: 'WAF_v2'
    capacity: ${propertyNumber(node, 'capacity', 2)}
  }
  properties: {
    gatewayIPConfigurations: [{
      name: 'gateway-ip-configuration'
      properties: { subnet: { id: resourceId('Microsoft.Network/virtualNetworks/subnets', ${topologySymbol(network.vnet)}.name, '${escapeBicep(network.subnet.label || network.subnet.id)}') } }
    }]
    frontendIPConfigurations: [{ name: 'public-frontend', properties: { publicIPAddress: { id: ${symbol}_public_ip.id } } }]
    frontendPorts: [{ name: 'https-port', properties: { port: 443 } }]
    sslCertificates: [{ name: 'gateway-certificate', properties: { data: ${prefix}SslCertificateData, password: ${prefix}SslCertificatePassword } }]
    backendAddressPools: [{ name: 'app-service-pool', properties: { backendAddresses: [{ fqdn: ${backend.symbol}.properties.defaultHostName }] } }]
    backendHttpSettingsCollection: [{
      name: 'https-settings'
      properties: { port: 443, protocol: 'Https', cookieBasedAffinity: 'Disabled', requestTimeout: 30, pickHostNameFromBackendAddress: true }
    }]
    httpListeners: [{
      name: 'https-listener'
      properties: {
        frontendIPConfiguration: { id: resourceId('Microsoft.Network/applicationGateways/frontendIPConfigurations', ${parameter}, 'public-frontend') }
        frontendPort: { id: resourceId('Microsoft.Network/applicationGateways/frontendPorts', ${parameter}, 'https-port') }
        protocol: 'Https'
        sslCertificate: { id: resourceId('Microsoft.Network/applicationGateways/sslCertificates', ${parameter}, 'gateway-certificate') }
      }
    }]
    requestRoutingRules: [{
      name: 'app-service-rule'
      properties: {
        ruleType: 'Basic'
        priority: 100
        httpListener: { id: resourceId('Microsoft.Network/applicationGateways/httpListeners', ${parameter}, 'https-listener') }
        backendAddressPool: { id: resourceId('Microsoft.Network/applicationGateways/backendAddressPools', ${parameter}, 'app-service-pool') }
        backendHttpSettings: { id: resourceId('Microsoft.Network/applicationGateways/backendHttpSettingsCollection', ${parameter}, 'https-settings') }
      }
    }]
  }
}`;
    }
    case 'aks':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    dnsPrefix: '${escapeBicep(slugify(context.defaultName).slice(0, 45) || 'aks')}'
    agentPoolProfiles: [{
      name: 'systempool'
      mode: 'System'
      count: ${propertyNumber(node, 'nodeCount', 3)}
      vmSize: '${propertyString(node, 'nodeSize', 'Standard_D4s_v5')}'
    }]
  }
}`;
    case 'container-apps': {
      const envSymbol = `${symbol}_env`;
      return `${avm}resource ${envSymbol} 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${escapeBicep(`${context.defaultName}-env`.slice(0, 60))}'
  location: location
  tags: tags
  properties: {}
}

resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: ${envSymbol}.id
    configuration: { ingress: { external: true, targetPort: 80 } }
    template: {
      containers: [{
        name: 'app'
        image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
        resources: { cpu: json('${propertyNumber(node, 'cpu', 0.5)}'), memory: '${propertyString(node, 'memory', '1Gi')}' }
      }]
      scale: { minReplicas: ${propertyNumber(node, 'minReplicas', 0)}, maxReplicas: ${propertyNumber(node, 'maxReplicas', 10)} }
    }
  }
}`;
    }
    case 'static-web-app':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Standard')}', tier: '${propertyString(node, 'sku', 'Standard')}' }
  properties: {}
}`;
    case 'api-management': {
      const prefix = camelCase(symbol);
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Developer')}', capacity: 1 }
  identity: { type: 'SystemAssigned' }
  properties: {
    publisherEmail: ${prefix}PublisherEmail
    publisherName: ${prefix}PublisherName
  }
}`;
    }
    case 'postgresql': {
      const prefix = camelCase(symbol);
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'size', 'Standard_D2ds_v5')}', tier: '${propertyString(node, 'tier', 'GeneralPurpose')}' }
  properties: {
    version: '16'
    administratorLogin: ${prefix}AdministratorLogin
    administratorLoginPassword: ${prefix}AdministratorPassword
    storage: { storageSizeGB: 128 }
  }
}`;
    }
    case 'load-balancer': {
      const pipSymbol = `${symbol}_public_ip`;
      return `${avm}resource ${pipSymbol} 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${escapeBicep(`${context.defaultName}-pip`.slice(0, 80))}'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Standard')}' }
  properties: {
    frontendIPConfigurations: [{
      name: 'public-frontend'
      properties: { publicIPAddress: { id: ${pipSymbol}.id } }
    }]
    backendAddressPools: [{ name: 'backend-pool' }]
  }
}`;
    }
    case 'front-door':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: 'global'
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Premium_AzureFrontDoor')}' }
  properties: {}
}`;
    case 'azure-openai':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: ${parameter}
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
  }
}`;
    case 'ai-search':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'standard')}' }
  properties: {
    replicaCount: ${propertyNumber(node, 'replicas', 1)}
    partitionCount: ${propertyNumber(node, 'partitions', 1)}
    publicNetworkAccess: 'disabled'
  }
}`;
    case 'event-hubs':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Standard')}', tier: '${propertyString(node, 'sku', 'Standard')}', capacity: ${propertyNumber(node, 'throughputUnits', 1)} }
  properties: { minimumTlsVersion: '1.2' }
}`;
    case 'data-explorer':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Standard_D11_v2')}', tier: 'Standard', capacity: ${propertyNumber(node, 'instances', 2)} }
  identity: { type: 'SystemAssigned' }
  properties: {}
}`;
    case 'service-bus':
      return `${avm}resource ${symbol} '${type}' = {
  name: ${parameter}
  location: location
  tags: tags
  sku: { name: '${propertyString(node, 'sku', 'Standard')}', tier: '${propertyString(node, 'sku', 'Standard')}' }
  properties: { minimumTlsVersion: '1.2' }
}`;
    default:
      return '';
  }
}

function generateTerraformFiles(
  diagram: Diagram,
  resources: ResourceContext[],
  diagnostics: IacDiagnostic[],
): IacFile[] {
  const versions = `${generatedHeader('#', diagram)}
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.0"
    }
  }
}

provider "azapi" {}
`;
  const nameVariables = renderTerraformNameVariables(resources);
  const variables = `${generatedHeader('#', diagram)}
variable "resource_group_name" {
  type        = string
  description = "Existing resource group that receives generated resources."
}

variable "location" {
  type        = string
  description = "Azure region for generated resources."
  default     = "${escapeHcl(diagram.metadata.region || 'eastus2')}"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to generated resources."
  default = {
    architecture-review = "${escapeHcl(slugify(diagram.metadata.name))}"
    managed-by           = "azure-architecture-review"
  }
}
${nameVariables ? `\n${nameVariables}\n` : ''}`;
  const networks = renderTerraformNetworks(diagram);
  const declarations = resources.map((resource) => renderTerraformResource(resource, resources, diagram)).join('\n\n');
  const main = `${generatedHeader('#', diagram)}
data "azapi_client_config" "current" {}

locals {
  resource_group_id = "/subscriptions/\${data.azapi_client_config.current.subscription_id}/resourceGroups/\${var.resource_group_name}"
}
${networks ? `\n${networks}\n` : ''}
${declarations ? `\n${declarations}\n` : ''}`;
  const outputs = `${generatedHeader('#', diagram)}
${resources
  .map(({ symbol }) => `output "${symbol}_resource_id" {
  value = azapi_resource.${symbol}.id
}`)
  .join('\n\n')}
`;

  return [
    { path: 'versions.tf', content: versions, language: 'hcl' },
    { path: 'variables.tf', content: variables, language: 'hcl' },
    { path: 'main.tf', content: main, language: 'hcl' },
    { path: 'outputs.tf', content: outputs, language: 'hcl' },
    { path: 'README.md', content: generateReadme(diagram, 'terraform', resources, diagnostics), language: 'markdown' },
  ];
}

function renderTerraformResource(context: ResourceContext, resources: ResourceContext[], diagram: Diagram): string {
  const { node, service, symbol } = context;
  if (node.serviceId === 'sql-database') {
    return `# ARM type: Microsoft.Sql/servers/databases
# AVM reference: ${service.iac?.avmModule}
resource "azapi_resource" "${symbol}_server" {
  type      = "Microsoft.Sql/servers@2023-08-01"
  name      = var.${symbol}_server_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    properties = {
      administratorLogin         = var.${symbol}_administrator_login
      administratorLoginPassword = var.${symbol}_administrator_password
      minimalTlsVersion           = "1.2"
      publicNetworkAccess         = "Disabled"
    }
  }
}

resource "azapi_resource" "${symbol}" {
  type      = "Microsoft.Sql/servers/databases@2023-08-01"
  name      = var.${symbol}_name
  parent_id = azapi_resource.${symbol}_server.id
  location  = var.location
  tags      = var.tags
  body = {
    sku = { name = "GP_S_Gen5_1", tier = "${propertyString(node, 'tier', 'GeneralPurpose')}", capacity = 1 }
    properties = { autoPauseDelay = 60, minCapacity = 0.5, zoneRedundant = false }
  }
}`;
  }
  if (node.serviceId === 'redis') {
    return `# ARM type: ${service.iac?.resourceType}
# AVM reference: ${service.iac?.avmModule}
resource "azapi_resource" "${symbol}" {
  type      = "Microsoft.Cache/redisEnterprise@2024-10-01"
  name      = var.${symbol}_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    sku = { name = "${propertyString(node, 'sku', 'Balanced_B1')}" }
    properties = { minimumTlsVersion = "1.2" }
  }
}

resource "azapi_resource" "${symbol}_database" {
  type      = "Microsoft.Cache/redisEnterprise/databases@2024-10-01"
  name      = "default"
  parent_id = azapi_resource.${symbol}.id
  body = {
    properties = { clientProtocol = "Encrypted", clusteringPolicy = "EnterpriseCluster" }
  }
}`;
  }
  if (node.serviceId === 'application-gateway') {
    const backend = findResource(resources, findRelatedNode(diagram, node, 'app-service'))!;
    const network = subnetForNode(diagram, node)!;
    return `# ARM type: ${service.iac?.resourceType}
# AVM reference: ${service.iac?.avmModule}
resource "azapi_resource" "${symbol}_public_ip" {
  type      = "Microsoft.Network/publicIPAddresses@2024-05-01"
  name      = "${escapeHcl(`${context.defaultName}-pip`.slice(0, 80))}"
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    sku = { name = "Standard" }
    properties = { publicIPAllocationMethod = "Static" }
  }
}

resource "azapi_resource" "${symbol}" {
  type      = "Microsoft.Network/applicationGateways@2024-05-01"
  name      = var.${symbol}_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  # The current AzAPI embedded schema omits Application Gateway's valid ARM sku field.
  schema_validation_enabled = false
  body = {
    sku = { name = "${propertyString(node, 'sku', 'WAF_v2')}", tier = "WAF_v2", capacity = ${propertyNumber(node, 'capacity', 2)} }
    properties = {
      gatewayIPConfigurations = [{
        name = "gateway-ip-configuration"
        properties = { subnet = { id = azapi_resource.${topologySymbol(network.subnet)}.id } }
      }]
      frontendIPConfigurations = [{ name = "public-frontend", properties = { publicIPAddress = { id = azapi_resource.${symbol}_public_ip.id } } }]
      frontendPorts = [{ name = "https-port", properties = { port = 443 } }]
      sslCertificates = [{ name = "gateway-certificate", properties = { data = var.${symbol}_ssl_certificate_data, password = var.${symbol}_ssl_certificate_password } }]
      backendAddressPools = [{ name = "app-service-pool", properties = { backendAddresses = [{ fqdn = "\${azapi_resource.${backend.symbol}.name}.azurewebsites.net" }] } }]
      backendHttpSettingsCollection = [{
        name = "https-settings"
        properties = { port = 443, protocol = "Https", cookieBasedAffinity = "Disabled", requestTimeout = 30, pickHostNameFromBackendAddress = true }
      }]
      httpListeners = [{
        name = "https-listener"
        properties = {
          frontendIPConfiguration = { id = "\${local.resource_group_id}/providers/Microsoft.Network/applicationGateways/\${var.${symbol}_name}/frontendIPConfigurations/public-frontend" }
          frontendPort            = { id = "\${local.resource_group_id}/providers/Microsoft.Network/applicationGateways/\${var.${symbol}_name}/frontendPorts/https-port" }
          protocol                = "Https"
          sslCertificate          = { id = "\${local.resource_group_id}/providers/Microsoft.Network/applicationGateways/\${var.${symbol}_name}/sslCertificates/gateway-certificate" }
        }
      }]
      requestRoutingRules = [{
        name = "app-service-rule"
        properties = {
          ruleType           = "Basic"
          priority           = 100
          httpListener       = { id = "\${local.resource_group_id}/providers/Microsoft.Network/applicationGateways/\${var.${symbol}_name}/httpListeners/https-listener" }
          backendAddressPool = { id = "\${local.resource_group_id}/providers/Microsoft.Network/applicationGateways/\${var.${symbol}_name}/backendAddressPools/app-service-pool" }
          backendHttpSettings = { id = "\${local.resource_group_id}/providers/Microsoft.Network/applicationGateways/\${var.${symbol}_name}/backendHttpSettingsCollection/https-settings" }
        }
      }]
    }
  }
}`;
  }
  if (node.serviceId === 'load-balancer') {
    return `# ARM type: ${service.iac?.resourceType}
# AVM reference: ${service.iac?.avmModule}
resource "azapi_resource" "${symbol}_public_ip" {
  type      = "Microsoft.Network/publicIPAddresses@2024-05-01"
  name      = "${escapeHcl(`${context.defaultName}-pip`.slice(0, 80))}"
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    sku        = { name = "Standard" }
    properties = { publicIPAllocationMethod = "Static" }
  }
}

resource "azapi_resource" "${symbol}" {
  type      = "Microsoft.Network/loadBalancers@2024-05-01"
  name      = var.${symbol}_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    sku = { name = "${propertyString(node, 'sku', 'Standard')}" }
    properties = {
      frontendIPConfigurations = [{
        name       = "public-frontend"
        properties = { publicIPAddress = { id = azapi_resource.${symbol}_public_ip.id } }
      }]
      backendAddressPools = [{ name = "backend-pool" }]
    }
  }
}`;
  }
  if (node.serviceId === 'container-apps') {
    return `# ARM type: ${service.iac?.resourceType}
# AVM reference: ${service.iac?.avmModule}
resource "azapi_resource" "${symbol}_env" {
  type      = "Microsoft.App/managedEnvironments@2024-03-01"
  name      = "${escapeHcl(`${context.defaultName}-env`.slice(0, 60))}"
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    properties = {}
  }
}

resource "azapi_resource" "${symbol}" {
  type      = "Microsoft.App/containerApps@2024-03-01"
  name      = var.${symbol}_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
  body = {
    properties = {
      managedEnvironmentId = azapi_resource.${symbol}_env.id
      configuration        = { ingress = { external = true, targetPort = 80 } }
      template = {
        containers = [{
          name      = "app"
          image     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
          resources = { cpu = ${propertyNumber(node, 'cpu', 0.5)}, memory = "${propertyString(node, 'memory', '1Gi')}" }
        }]
        scale = { minReplicas = ${propertyNumber(node, 'minReplicas', 0)}, maxReplicas = ${propertyNumber(node, 'maxReplicas', 10)} }
      }
    }
  }
}`;
  }
  if (node.serviceId === 'front-door') {
    return `# ARM type: ${service.iac?.resourceType}
# AVM reference: ${service.iac?.avmModule}
resource "azapi_resource" "${symbol}" {
  type      = "Microsoft.Cdn/profiles@2024-09-01"
  name      = var.${symbol}_name
  parent_id = local.resource_group_id
  location  = "global"
  tags      = var.tags
  body = {
    sku = { name = "${propertyString(node, 'sku', 'Premium_AzureFrontDoor')}" }
  }
}`;
  }
  const body = terraformBody(context, resources, diagram);
  const schemaValidationOverride = AZAPI_SCHEMA_OVERRIDE.has(node.serviceId)
    ? `\n  # The current AzAPI embedded schema is incomplete for ${service.name}; disable strict body validation.\n  schema_validation_enabled = false\n`
    : '';
  return `# ARM type: ${service.iac?.resourceType}
# AVM reference: ${service.iac?.avmModule ?? 'No catalog AVM mapping'}
resource "azapi_resource" "${symbol}" {
  type      = "${service.iac?.resourceType}@${API_VERSION[node.serviceId]}"
  name      = var.${symbol}_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags
${schemaValidationOverride}

  body = ${body}
}`;
}

function terraformBody(context: ResourceContext, resources: ResourceContext[], diagram: Diagram): string {
  const { node } = context;
  switch (node.serviceId) {
    case 'storage-account':
      return `{
    kind = "StorageV2"
    sku  = { name = "${propertyString(node, 'sku', 'Standard_LRS')}" }
    properties = {
      allowBlobPublicAccess     = false
      minimumTlsVersion         = "TLS1_2"
      publicNetworkAccess       = "Disabled"
      supportsHttpsTrafficOnly  = true
    }
  }`;
    case 'key-vault':
      return `{
    properties = {
      tenantId                = data.azapi_client_config.current.tenant_id
      enableRbacAuthorization = true
      enablePurgeProtection   = true
      publicNetworkAccess     = "Disabled"
      sku = { family = "A", name = "${propertyString(node, 'sku', 'standard').toLowerCase()}" }
    }
  }`;
    case 'managed-identity':
      return '{}';
    case 'vnet':
      return `{
    properties = {
      addressSpace = { addressPrefixes = ["${propertyString(node, 'addressSpace', '10.0.0.0/16')}"] }
    }
  }`;
    case 'log-analytics':
      return `{
    properties = {
      retentionInDays                 = ${propertyNumber(node, 'retentionDays', 30)}
      publicNetworkAccessForIngestion = "Disabled"
      publicNetworkAccessForQuery     = "Disabled"
    }
    sku = { name = "PerGB2018" }
  }`;
    case 'app-insights':
      {
        const workspace = resources.find((resource) => resource.node.serviceId === 'log-analytics');
      return `{
    kind = "web"
    properties = {
      Application_Type = "web"
      DisableLocalAuth  = true
      IngestionMode     = "${workspace ? 'LogAnalytics' : 'ApplicationInsights'}"
${workspace ? `      WorkspaceResourceId = azapi_resource.${workspace.symbol}.id\n` : ''}    }
  }`;
      }
    case 'container-registry':
      return `{
    sku = { name = "${propertyString(node, 'sku', 'Standard')}" }
    properties = {
      adminUserEnabled    = false
      publicNetworkAccess = "Disabled"
    }
  }`;
    case 'cosmos-db':
      return `{
    kind = "GlobalDocumentDB"
    properties = {
      databaseAccountOfferType = "Standard"
      disableLocalAuth          = true
      locations                 = [{ locationName = var.location, failoverPriority = 0 }]
      publicNetworkAccess       = "Disabled"
      consistencyPolicy         = { defaultConsistencyLevel = "Session" }
    }
  }`;
    case 'app-service-plan':
      return `{
    kind = "${propertyString(node, 'os', 'Linux').toLowerCase() === 'linux' ? 'linux' : 'app'}"
    sku  = { name = "${propertyString(node, 'sku', 'P1v3')}", capacity = ${propertyNumber(node, 'capacity', 1)} }
    properties = { reserved = ${propertyString(node, 'os', 'Linux').toLowerCase() === 'linux'} }
  }`;
    case 'app-service': {
      const plan = findResource(resources, findRelatedNode(diagram, node, 'app-service-plan'))!;
      const identity = findResource(resources, findRelatedNode(diagram, node, 'managed-identity'));
      const network = subnetForNode(diagram, node);
      const identityBody = identity
        ? `\n    identity = {\n      type = "UserAssigned"\n      userAssignedIdentities = { (azapi_resource.${identity.symbol}.id) = {} }\n    }`
        : '';
      const subnetBody = network ? `\n      virtualNetworkSubnetId = azapi_resource.${topologySymbol(network.subnet)}.id` : '';
      return `{
    kind = "app,linux"${identityBody}
    properties = {
      serverFarmId = azapi_resource.${plan.symbol}.id
      httpsOnly    = true${subnetBody}
      siteConfig = {
        linuxFxVersion = "${propertyString(node, 'runtime', 'NODE|20-lts')}"
        minTlsVersion  = "1.2"
        ftpsState      = "Disabled"
      }
    }
  }`;
    }
    case 'private-endpoint': {
      const targetNode = findRelatedNode(diagram, node)!;
      const target = findResource(resources, targetNode)!;
      const network = subnetForNode(diagram, node)!;
      const targetSymbol = targetNode.serviceId === 'sql-database' ? `${target.symbol}_server` : target.symbol;
      return `{
    properties = {
      subnet = { id = azapi_resource.${topologySymbol(network.subnet)}.id }
      privateLinkServiceConnections = [{
        name = "${escapeHcl(`${node.label || node.id}-connection`)}"
        properties = {
          privateLinkServiceId = azapi_resource.${targetSymbol}.id
          groupIds             = ["${privateLinkGroupId(targetNode.serviceId)}"]
        }
      }]
    }
  }`;
    }
    case 'aks':
      return `{
    identity = { type = "SystemAssigned" }
    properties = {
      dnsPrefix = "${escapeHcl(slugify(context.defaultName).slice(0, 45) || 'aks')}"
      agentPoolProfiles = [{
        name   = "systempool"
        mode   = "System"
        count  = ${propertyNumber(node, 'nodeCount', 3)}
        vmSize = "${propertyString(node, 'nodeSize', 'Standard_D4s_v5')}"
      }]
    }
  }`;
    case 'static-web-app':
      return `{
    sku        = { name = "${propertyString(node, 'sku', 'Standard')}", tier = "${propertyString(node, 'sku', 'Standard')}" }
    properties = {}
  }`;
    case 'api-management':
      return `{
    sku      = { name = "${propertyString(node, 'sku', 'Developer')}", capacity = 1 }
    identity = { type = "SystemAssigned" }
    properties = {
      publisherEmail = var.${context.symbol}_publisher_email
      publisherName  = var.${context.symbol}_publisher_name
    }
  }`;
    case 'postgresql':
      return `{
    sku = { name = "${propertyString(node, 'size', 'Standard_D2ds_v5')}", tier = "${propertyString(node, 'tier', 'GeneralPurpose')}" }
    properties = {
      version                    = "16"
      administratorLogin         = var.${context.symbol}_administrator_login
      administratorLoginPassword = var.${context.symbol}_administrator_password
      storage                    = { storageSizeGB = 128 }
    }
  }`;
    case 'azure-openai':
      return `{
    kind = "OpenAI"
    sku  = { name = "S0" }
    properties = {
      customSubDomainName = var.${context.symbol}_name
      publicNetworkAccess = "Disabled"
      disableLocalAuth    = true
    }
  }`;
    case 'ai-search':
      return `{
    sku = { name = "${propertyString(node, 'sku', 'standard')}" }
    properties = {
      replicaCount        = ${propertyNumber(node, 'replicas', 1)}
      partitionCount      = ${propertyNumber(node, 'partitions', 1)}
      publicNetworkAccess = "disabled"
    }
  }`;
    case 'event-hubs':
      return `{
    sku        = { name = "${propertyString(node, 'sku', 'Standard')}", tier = "${propertyString(node, 'sku', 'Standard')}", capacity = ${propertyNumber(node, 'throughputUnits', 1)} }
    properties = { minimumTlsVersion = "1.2" }
  }`;
    case 'data-explorer':
      return `{
    sku      = { name = "${propertyString(node, 'sku', 'Standard_D11_v2')}", tier = "Standard", capacity = ${propertyNumber(node, 'instances', 2)} }
    identity = { type = "SystemAssigned" }
    properties = {}
  }`;
    case 'service-bus':
      return `{
    sku        = { name = "${propertyString(node, 'sku', 'Standard')}", tier = "${propertyString(node, 'sku', 'Standard')}" }
    properties = { minimumTlsVersion = "1.2" }
  }`;
    default:
      return '{}';
  }
}

function generateReadme(
  diagram: Diagram,
  target: IacTarget,
  resources: ResourceContext[],
  diagnostics: IacDiagnostic[],
): string {
  const command = target === 'bicep'
    ? 'az deployment group create --resource-group <resource-group> --template-file main.bicep'
    : 'terraform init\nterraform plan -var="resource_group_name=<resource-group>"';
  const resourceLines = resources.length
    ? resources.map(({ node, service }) => `- ${node.label || service.name} (${service.iac?.resourceType})`).join('\n')
    : '- No deployable resources were generated.';
  const diagnosticLines = diagnostics.length
    ? diagnostics.map((item) => `- **${item.severity}:** ${item.message}`).join('\n')
    : '- No generation diagnostics.';

  return `# ${diagram.metadata.name} — ${target === 'bicep' ? 'Bicep' : 'Terraform'}

Generated deterministically by Azure Architecture Review. Review and test this scaffold before deployment; a diagram does not contain every workload, networking, identity, or data-migration input required for production.

## Generated resources

${resourceLines}

## Diagnostics

${diagnosticLines}

## Validate

\`\`\`shell
${command}
\`\`\`

Catalog AVM references are included as provenance comments. Pin and adopt a tested Azure Verified Module version when your organization standardizes on AVM composition.
`;
}

function generatedHeader(prefix: string, diagram: Diagram): string {
  return `${prefix} Generated from "${diagram.metadata.name}" by Azure Architecture Review.\n${prefix} Deterministic scaffold: review diagnostics and validate before deployment.`;
}

function uniqueIdentifier(value: string, used: Set<string>): string {
  const base = slugify(value).replace(/-/g, '_').replace(/^([0-9])/, 'resource_$1');
  let candidate = base || 'resource';
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function uniqueResourceName(diagramName: string, node: DiagramNode, used: Set<string>): string {
  const compact = node.serviceId === 'storage-account' || node.serviceId === 'container-registry';
  const maxLength = compact ? 24 : 63;
  const raw = compact
    ? `${diagramName}-${node.label || node.serviceId}`.toLowerCase().replace(/[^a-z0-9]/g, '')
    : slugify(`${diagramName}-${node.label || node.serviceId}`);
  const base = (raw || `resource${node.id.replace(/[^a-z0-9]/gi, '')}`).slice(0, maxLength);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const text = String(suffix++);
    candidate = `${base.slice(0, maxLength - text.length)}${text}`;
  }
  used.add(candidate);
  return candidate;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function camelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function propertyString(node: DiagramNode, key: string, fallback: string): string {
  const value = node.properties[key];
  return typeof value === 'string' && value.trim() ? value.replace(/['"\n\r]/g, '') : fallback;
}

function propertyNumber(node: DiagramNode, key: string, fallback: number): number {
  const value = node.properties[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function escapeBicep(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeHcl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$\{/g, '$${');
}