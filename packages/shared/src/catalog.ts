import { z } from 'zod';

/**
 * Azure service catalog — the shared registry of services that can be placed on
 * the canvas. Each entry maps a stable `id` to display metadata, an icon slug,
 * sensible default properties, pricing hints (for the Retail Prices API), and an
 * IaC hint (Azure Verified Module / Bicep resource type) used by the IaC exporter.
 *
 * This is UI-agnostic: the web app resolves `icon` to an asset, the API uses
 * `pricing` + `iac` for cost estimation and export.
 */

/** Broad grouping used for palette organization and filtering. */
export const serviceCategorySchema = z.enum([
  'compute',
  'containers',
  'web',
  'databases',
  'storage',
  'networking',
  'ai',
  'analytics',
  'integration',
  'security',
  'identity',
  'devops',
  'management',
]);
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

/** Hints the pricing engine uses to query the Azure Retail Prices API. */
export const pricingHintSchema = z.object({
  /** `armSkuName` / service name filter as used by the Retail Prices API. */
  serviceName: z.string(),
  /** Optional product name filter to disambiguate meters. */
  productName: z.string().optional(),
  /** Whether this resource is typically consumption-based (vs. fixed monthly). */
  consumptionBased: z.boolean().default(false),
});
export type PricingHint = z.infer<typeof pricingHintSchema>;

/** Hints the IaC exporter uses to emit Bicep / Azure Verified Modules. */
export const iacHintSchema = z.object({
  /** ARM resource type, e.g. "Microsoft.Storage/storageAccounts". */
  resourceType: z.string(),
  /** Azure Verified Module reference, when one exists. */
  avmModule: z.string().optional(),
});
export type IacHint = z.infer<typeof iacHintSchema>;

export const serviceDefinitionSchema = z.object({
  /** Stable identifier referenced by `DiagramNode.serviceId`. */
  id: z.string().min(1),
  /** Human-readable display name. */
  name: z.string().min(1),
  category: serviceCategorySchema,
  /** Short description shown in the palette tooltip / properties panel. */
  description: z.string().default(''),
  /** Icon asset slug (resolves to apps/web/src/assets/azure-icons/<icon>.svg). */
  icon: z.string().min(1),
  /** Default property values applied when a node is created. */
  defaults: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  pricing: pricingHintSchema.optional(),
  iac: iacHintSchema.optional(),
  /** Documentation URL for the service. */
  docsUrl: z.string().url().optional(),
});
export type ServiceDefinition = z.infer<typeof serviceDefinitionSchema>;

/**
 * The catalog. Kept as a plain array so it is trivially serializable and can be
 * shipped to the client. Icon slugs assume the official Microsoft Azure
 * Architecture Icons set bundled under apps/web/src/assets/azure-icons/.
 */
export const azureServiceCatalog: ServiceDefinition[] = [
  // ---- Compute ------------------------------------------------------------
  {
    id: 'vm',
    name: 'Virtual Machine',
    category: 'compute',
    description: 'Provision Linux or Windows virtual machines.',
    icon: 'virtual-machine',
    defaults: { size: 'Standard_D2s_v5', os: 'Linux' },
    pricing: { serviceName: 'Virtual Machines', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Compute/virtualMachines',
      avmModule: 'br/public:avm/res/compute/virtual-machine',
    },
    docsUrl: 'https://learn.microsoft.com/azure/virtual-machines/',
  },
  {
    id: 'vmss',
    name: 'VM Scale Set',
    category: 'compute',
    description: 'Autoscaling group of identical virtual machines.',
    icon: 'vm-scale-set',
    defaults: { size: 'Standard_D2s_v5', instances: 2, zoneRedundant: false },
    pricing: { serviceName: 'Virtual Machines', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Compute/virtualMachineScaleSets',
      avmModule: 'br/public:avm/res/compute/virtual-machine-scale-set',
    },
  },
  {
    id: 'functions',
    name: 'Azure Functions',
    category: 'compute',
    description: 'Event-driven serverless compute.',
    icon: 'function-app',
    defaults: { plan: 'FlexConsumption', runtime: 'node', zoneRedundant: false, multiRegion: false },
    pricing: { serviceName: 'Functions', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Web/sites',
      avmModule: 'br/public:avm/res/web/site',
    },
    docsUrl: 'https://learn.microsoft.com/azure/azure-functions/',
  },

  // ---- Containers ---------------------------------------------------------
  {
    id: 'container-apps',
    name: 'Container Apps',
    category: 'containers',
    description: 'Serverless containers with scale-to-zero.',
    icon: 'container-app',
    defaults: { cpu: 0.5, memory: '1Gi', minReplicas: 0, maxReplicas: 10, zoneRedundant: false },
    pricing: { serviceName: 'Azure Container Apps', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.App/containerApps',
      avmModule: 'br/public:avm/res/app/container-app',
    },
    docsUrl: 'https://learn.microsoft.com/azure/container-apps/',
  },
  {
    id: 'aks',
    name: 'Azure Kubernetes Service',
    category: 'containers',
    description: 'Managed Kubernetes cluster.',
    icon: 'kubernetes-service',
    defaults: { tier: 'Standard', nodeCount: 3, nodeSize: 'Standard_D4s_v5', zoneRedundant: false },
    pricing: { serviceName: 'Azure Kubernetes Service', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.ContainerService/managedClusters',
      avmModule: 'br/public:avm/res/container-service/managed-cluster',
    },
    docsUrl: 'https://learn.microsoft.com/azure/aks/',
  },
  {
    id: 'container-registry',
    name: 'Container Registry',
    category: 'containers',
    description: 'Private Docker/OCI image registry.',
    icon: 'container-registry',
    defaults: { sku: 'Standard', zoneRedundant: false, multiRegion: false },
    pricing: { serviceName: 'Container Registry', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.ContainerRegistry/registries',
      avmModule: 'br/public:avm/res/container-registry/registry',
    },
  },

  // ---- Web ----------------------------------------------------------------
  {
    id: 'app-service',
    name: 'App Service',
    category: 'web',
    description: 'Managed hosting for web apps and APIs.',
    icon: 'app-service',
    defaults: { sku: 'P1v3', os: 'Linux' },
    pricing: { serviceName: 'Azure App Service', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.Web/sites',
      avmModule: 'br/public:avm/res/web/site',
    },
    docsUrl: 'https://learn.microsoft.com/azure/app-service/',
  },
  {
    id: 'app-service-plan',
    name: 'App Service Plan',
    category: 'web',
    description: 'Compute resources for App Service apps.',
    icon: 'app-service-plan',
    defaults: { sku: 'P1v3', os: 'Linux', capacity: 2, zoneRedundant: false },
    pricing: { serviceName: 'Azure App Service', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.Web/serverfarms',
      avmModule: 'br/public:avm/res/web/serverfarm',
    },
  },
  {
    id: 'static-web-app',
    name: 'Static Web Apps',
    category: 'web',
    description: 'Globally distributed static sites with APIs.',
    icon: 'static-apps',
    defaults: { sku: 'Standard' },
    pricing: { serviceName: 'Azure App Service', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.Web/staticSites',
      avmModule: 'br/public:avm/res/web/static-site',
    },
  },
  {
    id: 'api-management',
    name: 'API Management',
    category: 'web',
    description: 'Publish, secure, and manage APIs.',
    icon: 'api-management',
    defaults: { sku: 'Developer', zoneRedundant: false, multiRegion: false },
    pricing: { serviceName: 'API Management', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.ApiManagement/service',
      avmModule: 'br/public:avm/res/api-management/service',
    },
  },

  // ---- Databases ----------------------------------------------------------
  {
    id: 'sql-database',
    name: 'Azure SQL Database',
    category: 'databases',
    description: 'Managed relational SQL database.',
    icon: 'sql-database',
    defaults: { tier: 'GeneralPurpose', compute: 'Serverless', zoneRedundant: false, multiRegion: false },
    pricing: { serviceName: 'SQL Database', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.Sql/servers/databases',
      avmModule: 'br/public:avm/res/sql/server',
    },
    docsUrl: 'https://learn.microsoft.com/azure/azure-sql/database/',
  },
  {
    id: 'cosmos-db',
    name: 'Azure Cosmos DB',
    category: 'databases',
    description: 'Globally distributed multi-model NoSQL database.',
    icon: 'cosmos-db',
    defaults: { api: 'NoSQL', mode: 'Serverless', zoneRedundant: false, multiRegion: false },
    pricing: { serviceName: 'Azure Cosmos DB', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.DocumentDB/databaseAccounts',
      avmModule: 'br/public:avm/res/document-db/database-account',
    },
    docsUrl: 'https://learn.microsoft.com/azure/cosmos-db/',
  },
  {
    id: 'postgresql',
    name: 'Azure Database for PostgreSQL',
    category: 'databases',
    description: 'Managed PostgreSQL flexible server.',
    icon: 'postgresql-server',
    defaults: { tier: 'GeneralPurpose', size: 'Standard_D2ds_v5', zoneRedundant: false },
    pricing: { serviceName: 'Azure Database for PostgreSQL', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.DBforPostgreSQL/flexibleServers',
      avmModule: 'br/public:avm/res/db-for-postgre-sql/flexible-server',
    },
  },
  {
    id: 'redis',
    name: 'Azure Managed Redis',
    category: 'databases',
    description: 'In-memory data cache.',
    icon: 'cache-redis',
    defaults: { sku: 'Balanced_B1', zoneRedundant: false },
    pricing: { serviceName: 'Azure Cache for Redis', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.Cache/redisEnterprise',
      avmModule: 'br/public:avm/res/cache/redis-enterprise',
    },
  },

  // ---- Storage ------------------------------------------------------------
  {
    id: 'storage-account',
    name: 'Storage Account',
    category: 'storage',
    description: 'Blobs, files, queues, and tables.',
    icon: 'storage-account',
    defaults: { sku: 'Standard_LRS', kind: 'StorageV2', accessTier: 'Hot', multiRegion: false },
    pricing: { serviceName: 'Storage', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Storage/storageAccounts',
      avmModule: 'br/public:avm/res/storage/storage-account',
    },
    docsUrl: 'https://learn.microsoft.com/azure/storage/',
  },

  // ---- Networking ---------------------------------------------------------
  {
    id: 'vnet',
    name: 'Virtual Network',
    category: 'networking',
    description: 'Isolated network for Azure resources.',
    icon: 'virtual-network',
    defaults: { addressSpace: '10.0.0.0/16' },
    pricing: { serviceName: 'Virtual Network', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Network/virtualNetworks',
      avmModule: 'br/public:avm/res/network/virtual-network',
    },
  },
  {
    id: 'load-balancer',
    name: 'Load Balancer',
    category: 'networking',
    description: 'Layer-4 load balancing.',
    icon: 'load-balancer',
    defaults: { sku: 'Standard', zoneRedundant: false },
    pricing: { serviceName: 'Load Balancer', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Network/loadBalancers',
      avmModule: 'br/public:avm/res/network/load-balancer',
    },
  },
  {
    id: 'application-gateway',
    name: 'Application Gateway',
    category: 'networking',
    description: 'Layer-7 load balancer with WAF.',
    icon: 'application-gateway',
    defaults: { sku: 'WAF_v2', capacity: 2, zoneRedundant: false },
    pricing: { serviceName: 'Application Gateway', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Network/applicationGateways',
      avmModule: 'br/public:avm/res/network/application-gateway',
    },
  },
  {
    id: 'front-door',
    name: 'Azure Front Door',
    category: 'networking',
    description: 'Global CDN and application delivery.',
    icon: 'front-door',
    defaults: { sku: 'Premium_AzureFrontDoor' },
    pricing: { serviceName: 'Azure Front Door Service', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Cdn/profiles',
      avmModule: 'br/public:avm/res/cdn/profile',
    },
  },
  {
    id: 'private-endpoint',
    name: 'Private Endpoint',
    category: 'networking',
    description: 'Private connectivity to Azure services.',
    icon: 'private-endpoint',
    defaults: {},
    pricing: { serviceName: 'Virtual Network Private Link', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Network/privateEndpoints',
      avmModule: 'br/public:avm/res/network/private-endpoint',
    },
  },

  // ---- AI -----------------------------------------------------------------
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    category: 'ai',
    description: 'Managed OpenAI models (GPT, embeddings).',
    icon: 'azure-openai',
    defaults: { deployment: 'gpt-4o', sku: 'Standard', multiRegion: false },
    pricing: { serviceName: 'Azure OpenAI', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.CognitiveServices/accounts',
      avmModule: 'br/public:avm/res/cognitive-services/account',
    },
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/',
  },
  {
    id: 'ai-search',
    name: 'Azure AI Search',
    category: 'ai',
    description: 'Vector and hybrid search index.',
    icon: 'cognitive-search',
    defaults: { sku: 'standard', replicas: 1, partitions: 1, zoneRedundant: false },
    pricing: { serviceName: 'Azure Cognitive Search', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.Search/searchServices',
      avmModule: 'br/public:avm/res/search/search-service',
    },
  },
  {
    id: 'ai-foundry',
    name: 'Azure AI Foundry',
    category: 'ai',
    description: 'AI project hub and model catalog.',
    icon: 'ai-studio',
    defaults: {},
    pricing: { serviceName: 'Azure Machine Learning', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.MachineLearningServices/workspaces',
      avmModule: 'br/public:avm/res/machine-learning-services/workspace',
    },
  },

  // ---- Analytics ----------------------------------------------------------
  {
    id: 'event-hubs',
    name: 'Event Hubs',
    category: 'analytics',
    description: 'Big data streaming and event ingestion.',
    icon: 'event-hubs',
    defaults: { sku: 'Standard', throughputUnits: 1, zoneRedundant: false, multiRegion: false },
    pricing: { serviceName: 'Event Hubs', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.EventHub/namespaces',
      avmModule: 'br/public:avm/res/event-hub/namespace',
    },
  },
  {
    id: 'data-explorer',
    name: 'Azure Data Explorer',
    category: 'analytics',
    description: 'Fast telemetry and log analytics (Kusto).',
    icon: 'data-explorer-clusters',
    defaults: { sku: 'Standard_D11_v2', instances: 2, zoneRedundant: false },
    pricing: { serviceName: 'Azure Data Explorer', consumptionBased: false },
    iac: {
      resourceType: 'Microsoft.Kusto/clusters',
      avmModule: 'br/public:avm/res/kusto/cluster',
    },
  },

  // ---- Integration --------------------------------------------------------
  {
    id: 'service-bus',
    name: 'Service Bus',
    category: 'integration',
    description: 'Enterprise messaging queues and topics.',
    icon: 'service-bus',
    defaults: { sku: 'Standard', zoneRedundant: false, multiRegion: false },
    pricing: { serviceName: 'Service Bus', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.ServiceBus/namespaces',
      avmModule: 'br/public:avm/res/service-bus/namespace',
    },
  },
  {
    id: 'logic-apps',
    name: 'Logic Apps',
    category: 'integration',
    description: 'Low-code workflow automation.',
    icon: 'logic-apps',
    defaults: { plan: 'Standard', zoneRedundant: false },
    pricing: { serviceName: 'Logic Apps', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Web/sites',
      avmModule: 'br/public:avm/res/web/site',
    },
  },

  // ---- Security & Identity ------------------------------------------------
  {
    id: 'key-vault',
    name: 'Key Vault',
    category: 'security',
    description: 'Secrets, keys, and certificate storage.',
    icon: 'key-vault',
    defaults: { sku: 'standard' },
    pricing: { serviceName: 'Key Vault', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.KeyVault/vaults',
      avmModule: 'br/public:avm/res/key-vault/vault',
    },
    docsUrl: 'https://learn.microsoft.com/azure/key-vault/',
  },
  {
    id: 'managed-identity',
    name: 'Managed Identity',
    category: 'identity',
    description: 'Azure AD identity for resources.',
    icon: 'managed-identities',
    defaults: { type: 'UserAssigned' },
    iac: {
      resourceType: 'Microsoft.ManagedIdentity/userAssignedIdentities',
      avmModule: 'br/public:avm/res/managed-identity/user-assigned-identity',
    },
  },
  {
    id: 'entra-id',
    name: 'Microsoft Entra ID',
    category: 'identity',
    description: 'Identity and access management.',
    icon: 'entra-id',
    defaults: {},
    docsUrl: 'https://learn.microsoft.com/entra/',
  },

  // ---- Management & Monitoring --------------------------------------------
  {
    id: 'log-analytics',
    name: 'Log Analytics Workspace',
    category: 'management',
    description: 'Centralized logs and queries.',
    icon: 'log-analytics-workspaces',
    defaults: { sku: 'PerGB2018', retentionInDays: 30, zoneRedundant: false },
    pricing: { serviceName: 'Log Analytics', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.OperationalInsights/workspaces',
      avmModule: 'br/public:avm/res/operational-insights/workspace',
    },
  },
  {
    id: 'app-insights',
    name: 'Application Insights',
    category: 'management',
    description: 'Application performance monitoring.',
    icon: 'application-insights',
    defaults: { kind: 'web' },
    pricing: { serviceName: 'Application Insights', consumptionBased: true },
    iac: {
      resourceType: 'Microsoft.Insights/components',
      avmModule: 'br/public:avm/res/insights/component',
    },
  },
];

/** Fast lookup map keyed by service id. Built once at module load. */
export const azureServiceCatalogById: Readonly<Record<string, ServiceDefinition>> =
  Object.freeze(
    Object.fromEntries(azureServiceCatalog.map((s) => [s.id, s])),
  );

/** Resolve a service definition by id, or undefined if unknown. */
export function getServiceDefinition(id: string): ServiceDefinition | undefined {
  return azureServiceCatalogById[id];
}

/**
 * Sentinel serviceId for a component that has no Azure equivalent (e.g. a
 * third-party SaaS or external system). Kept on the canvas in faithful mode and
 * flagged with a red glow instead of being dropped. Not part of the palette.
 */
export const EXTERNAL_SERVICE_ID = 'external';

/** Whether a node represents a non-Azure / external component. */
export function isExternalServiceId(id: string): boolean {
  return id === EXTERNAL_SERVICE_ID;
}

/** All services in a given category. */
export function getServicesByCategory(category: ServiceCategory): ServiceDefinition[] {
  return azureServiceCatalog.filter((s) => s.category === category);
}

/** The list of categories that actually have services, in catalog order. */
export function getServiceCategories(): ServiceCategory[] {
  const seen = new Set<ServiceCategory>();
  for (const s of azureServiceCatalog) seen.add(s.category);
  return [...seen];
}
