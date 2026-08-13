import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServiceCategory } from '@aar/shared';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');

export const PATHS = {
  generatedCatalog: resolve(REPO_ROOT, 'packages/shared/src/catalog.generated.ts'),
  bundledIcons: resolve(REPO_ROOT, 'apps/web/src/assets/azure-icons'),
  popularityCache: resolve(here, '../popularity.json'),
};

/** Extra official-icon library to copy matched SVGs from (extracted Azure icon set). */
export const AZURE_ICONS_DIR = process.env.AZURE_ICONS_DIR;

/** A pinned service is always emitted regardless of popularity or fuzzy icon match. */
export interface Pin {
  id: string;
  name: string;
  category: ServiceCategory;
  resourceType: string;
  avmModule: string;
  icon: string;
  description?: string;
  pricing?: { serviceName: string; consumptionBased?: boolean };
  docsUrl?: string;
}

/** Services the maintainers always want present, even though usage is long-tail. */
export const PINS: Pin[] = [
  {
    id: 'fabric',
    name: 'Microsoft Fabric',
    category: 'analytics',
    description: 'Unified analytics platform (capacity).',
    icon: 'fabric',
    resourceType: 'Microsoft.Fabric/capacities',
    avmModule: 'br/public:avm/res/fabric/capacity',
    pricing: { serviceName: 'Microsoft Fabric', consumptionBased: true },
    docsUrl: 'https://learn.microsoft.com/fabric/',
  },
  {
    id: 'service-fabric',
    name: 'Service Fabric Cluster',
    category: 'compute',
    description: 'Distributed microservices platform.',
    icon: 'service-fabric',
    resourceType: 'Microsoft.ServiceFabric/clusters',
    avmModule: 'br/public:avm/res/service-fabric/cluster',
    docsUrl: 'https://learn.microsoft.com/azure/service-fabric/',
  },
  {
    id: 'power-bi-embedded',
    name: 'Power BI Embedded',
    category: 'analytics',
    description: 'Dedicated capacity for embedded analytics.',
    icon: 'power-bi',
    resourceType: 'Microsoft.PowerBIDedicated/capacities',
    avmModule: 'br/public:avm/res/power-bi-dedicated/capacity',
    pricing: { serviceName: 'Power BI Embedded' },
    docsUrl: 'https://learn.microsoft.com/power-bi/developer/embedded/',
  },
];

/** ARM provider namespace (lowercased) -> catalog category. Fallback: 'management'. */
export const CATEGORY_BY_PROVIDER: Record<string, ServiceCategory> = {
  'microsoft.compute': 'compute',
  'microsoft.servicefabric': 'compute',
  'microsoft.app': 'containers',
  'microsoft.containerservice': 'containers',
  'microsoft.containerregistry': 'containers',
  'microsoft.containerinstance': 'containers',
  'microsoft.web': 'web',
  'microsoft.apimanagement': 'web',
  'microsoft.sql': 'databases',
  'microsoft.dbformysql': 'databases',
  'microsoft.dbforpostgresql': 'databases',
  'microsoft.documentdb': 'databases',
  'microsoft.cache': 'databases',
  'microsoft.storage': 'storage',
  'microsoft.netapp': 'storage',
  'microsoft.elasticsan': 'storage',
  'microsoft.network': 'networking',
  'microsoft.cdn': 'networking',
  'microsoft.cognitiveservices': 'ai',
  'microsoft.machinelearningservices': 'ai',
  'microsoft.search': 'ai',
  'microsoft.fabric': 'analytics',
  'microsoft.powerbidedicated': 'analytics',
  'microsoft.synapse': 'analytics',
  'microsoft.kusto': 'analytics',
  'microsoft.databricks': 'analytics',
  'microsoft.eventhub': 'analytics',
  'microsoft.servicebus': 'integration',
  'microsoft.eventgrid': 'integration',
  'microsoft.logic': 'integration',
  'microsoft.keyvault': 'security',
  'microsoft.managedidentity': 'identity',
  'microsoft.insights': 'management',
  'microsoft.operationalinsights': 'management',
};

/** resourceType (lowercased) -> icon slug, when name matching is unreliable. */
export const ICON_OVERRIDES: Record<string, string> = {
  'microsoft.fabric/capacities': 'fabric',
  'microsoft.servicefabric/clusters': 'service-fabric',
  'microsoft.powerbidedicated/capacities': 'power-bi',
};

export function categoryForResourceType(resourceType: string): ServiceCategory {
  const provider = resourceType.split('/')[0]?.toLowerCase() ?? '';
  return CATEGORY_BY_PROVIDER[provider] ?? 'management';
}
