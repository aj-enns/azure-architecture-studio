import { azureServiceCatalog } from '@aar/shared';

/**
 * A distilled Azure Architecture Center reference architecture used to ground
 * diagram generation (retrieval-augmented). Each entry maps an official
 * recommended architecture to the catalog service ids this app can render, so
 * the model adapts a proven Azure pattern instead of inventing topology.
 *
 * Source: Azure Architecture Center — https://learn.microsoft.com/azure/architecture/
 */
export interface ReferenceArchitecture {
  id: string;
  name: string;
  /** One-line description of the workload the pattern targets. */
  summary: string;
  /** Catalog service ids (must exist in azureServiceCatalog) the pattern uses. */
  services: string[];
  /** Free-text signals used for retrieval scoring against the user's prompt. */
  keywords: string[];
  /** Canonical Azure Architecture Center documentation URL. */
  docsUrl: string;
}

export const referenceArchitectures: ReferenceArchitecture[] = [
  {
    id: 'basic-web-app',
    name: 'Basic web application (App Service)',
    summary:
      'A single-region App Service web app with a managed database, secrets in Key Vault, and monitoring.',
    services: ['app-service', 'app-service-plan', 'sql-database', 'key-vault', 'managed-identity', 'app-insights'],
    keywords: ['web app', 'website', 'app service', 'basic', 'simple', 'api', 'backend', 'crud'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/basic-web-app',
  },
  {
    id: 'baseline-zone-redundant-web-app',
    name: 'Baseline zone-redundant App Service web app',
    summary:
      'Production App Service baseline: Front Door + Application Gateway (WAF), private endpoints, zone-redundant SQL, Key Vault, and full observability inside a VNet.',
    services: [
      'front-door',
      'application-gateway',
      'app-service',
      'app-service-plan',
      'sql-database',
      'key-vault',
      'private-endpoint',
      'vnet',
      'managed-identity',
      'app-insights',
      'log-analytics',
    ],
    keywords: ['production', 'baseline', 'highly available', 'zone redundant', 'waf', 'secure web app', 'enterprise', 'resilient'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/baseline-zone-redundant',
  },
  {
    id: 'serverless-web-app',
    name: 'Serverless web application',
    summary:
      'Static front end on Static Web Apps with Azure Functions APIs and a Cosmos DB back end, fronted by API Management.',
    services: ['static-web-app', 'functions', 'cosmos-db', 'api-management', 'app-insights', 'managed-identity'],
    keywords: ['serverless', 'static web app', 'spa', 'jamstack', 'functions', 'cosmos', 'low cost', 'scale to zero'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/web-apps/serverless/architectures/web-app',
  },
  {
    id: 'serverless-event-processing',
    name: 'Serverless event processing',
    summary:
      'Ingest a stream with Event Hubs, process with Azure Functions, and persist to Cosmos DB — an event-driven pipeline.',
    services: ['event-hubs', 'functions', 'cosmos-db', 'storage-account', 'app-insights'],
    keywords: ['event', 'event-driven', 'stream', 'streaming', 'ingest', 'pipeline', 'telemetry', 'iot', 'real-time', 'event hubs', 'kafka'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/reference-architectures/serverless/event-processing',
  },
  {
    id: 'web-queue-worker',
    name: 'Web-Queue-Worker (async messaging)',
    summary:
      'A web front end that offloads long-running work to a worker via a Service Bus queue, decoupling request handling from processing.',
    services: ['app-service', 'service-bus', 'functions', 'sql-database', 'key-vault', 'app-insights'],
    keywords: ['queue', 'worker', 'async', 'asynchronous', 'message', 'service bus', 'background job', 'decouple', 'competing consumers'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/guide/architecture-styles/web-queue-worker',
  },
  {
    id: 'baseline-aks',
    name: 'AKS baseline cluster',
    summary:
      'Production Azure Kubernetes Service baseline: private cluster in a VNet, Application Gateway ingress with WAF, ACR, Key Vault, and monitoring.',
    services: [
      'aks',
      'container-registry',
      'application-gateway',
      'vnet',
      'private-endpoint',
      'key-vault',
      'managed-identity',
      'log-analytics',
      'app-insights',
    ],
    keywords: ['kubernetes', 'aks', 'cluster', 'containers', 'baseline', 'ingress', 'production kubernetes'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks/baseline-aks',
  },
  {
    id: 'aks-microservices',
    name: 'Microservices on AKS',
    summary:
      'Microservices hosted on AKS with API Management gateway, Service Bus for async messaging, Cosmos DB, and ACR.',
    services: ['aks', 'container-registry', 'api-management', 'application-gateway', 'service-bus', 'cosmos-db', 'key-vault', 'log-analytics'],
    keywords: ['microservices', 'micro-services', 'kubernetes', 'aks', 'api gateway', 'service mesh', 'domain services'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks-microservices/aks-microservices',
  },
  {
    id: 'container-apps-microservices',
    name: 'Microservices with Azure Container Apps',
    summary:
      'Serverless microservices on Azure Container Apps with ACR, Service Bus, Cosmos DB, and API Management — scale-to-zero without managing Kubernetes.',
    services: ['container-apps', 'container-registry', 'service-bus', 'cosmos-db', 'api-management', 'key-vault', 'log-analytics', 'app-insights'],
    keywords: ['container apps', 'aca', 'serverless containers', 'microservices', 'scale to zero', 'dapr'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/example-scenario/serverless/microservices-with-container-apps',
  },
  {
    id: 'baseline-openai-chat',
    name: 'Baseline OpenAI end-to-end chat',
    summary:
      'Enterprise RAG chat app: App Service front end calling Azure OpenAI grounded by Azure AI Search, orchestrated via AI Foundry, inside a VNet with private endpoints and Key Vault.',
    services: [
      'app-service',
      'azure-openai',
      'ai-search',
      'ai-foundry',
      'key-vault',
      'managed-identity',
      'private-endpoint',
      'vnet',
      'app-insights',
    ],
    keywords: ['openai', 'gpt', 'llm', 'chat', 'chatbot', 'rag', 'retrieval', 'ai search', 'copilot', 'generative ai', 'embeddings', 'foundry'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/ai-ml/architecture/baseline-openai-e2e-chat',
  },
  {
    id: 'n-tier-vms',
    name: 'N-tier application on virtual machines',
    summary:
      'Classic N-tier app: load-balanced web/app tiers on VM scale sets behind Application Gateway, with a SQL database, in a VNet.',
    services: ['vmss', 'vm', 'load-balancer', 'application-gateway', 'sql-database', 'vnet', 'key-vault'],
    keywords: ['n-tier', 'three tier', '3-tier', 'virtual machine', 'vm', 'iaas', 'lift and shift', 'migrate', 'legacy'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/reference-architectures/n-tier/n-tier-sql-server',
  },
  {
    id: 'hub-spoke',
    name: 'Hub-spoke network topology',
    summary:
      'Centralized hub VNet with shared services (gateway, firewall, private DNS) peered to isolated spoke VNets for workloads.',
    services: ['vnet', 'application-gateway', 'load-balancer', 'private-endpoint'],
    keywords: ['hub spoke', 'hub-and-spoke', 'network topology', 'vnet peering', 'landing zone', 'connectivity', 'segmentation'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke',
  },
  {
    id: 'realtime-analytics-adx',
    name: 'Real-time analytics with Azure Data Explorer',
    summary:
      'High-volume telemetry ingested via Event Hubs into Azure Data Explorer for interactive, near-real-time analytics.',
    services: ['event-hubs', 'data-explorer', 'functions', 'storage-account'],
    keywords: ['analytics', 'real-time analytics', 'time series', 'telemetry', 'logs', 'kusto', 'data explorer', 'dashboards', 'observability'],
    docsUrl: 'https://learn.microsoft.com/azure/architecture/solution-ideas/articles/big-data-azure-data-explorer',
  },
];

/** Set of valid catalog ids, used to keep the knowledge base honest. */
const catalogIds = new Set(azureServiceCatalog.map((s) => s.id));

/** Reference architectures whose service ids all exist in the catalog. */
export function validateReferenceArchitectures(): string[] {
  const problems: string[] = [];
  for (const ra of referenceArchitectures) {
    for (const id of ra.services) {
      if (!catalogIds.has(id)) problems.push(`${ra.id}: unknown serviceId "${id}"`);
    }
  }
  return problems;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'to', 'of', 'in', 'on', 'my', 'our',
  'app', 'application', 'azure', 'using', 'use', 'that', 'this', 'build', 'create', 'need', 'want',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Retrieve the most relevant reference architectures for a prompt. Lightweight
 * keyword/phrase scoring (no embeddings) — deterministic and dependency-free;
 * swap in vector similarity or Azure AI Search later without changing callers.
 */
export function retrieveArchitectures(prompt: string, k = 3): ReferenceArchitecture[] {
  const promptText = prompt.toLowerCase();
  const tokens = new Set(tokenize(prompt));

  const scored = referenceArchitectures.map((ra) => {
    let score = 0;
    for (const kw of ra.keywords) {
      // Whole-phrase hit (e.g. "event driven") is worth more than a token hit.
      if (kw.includes(' ')) {
        if (promptText.includes(kw)) score += 3;
      } else if (tokens.has(kw)) {
        score += 2;
      }
    }
    // A service the user named by keyword also nudges the score.
    for (const id of ra.services) {
      if (tokens.has(id) || promptText.includes(id.replace(/-/g, ' '))) score += 1;
    }
    return { ra, score };
  });

  const hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.ra);

  // No signal in the prompt — fall back to the two most common starting points
  // so generation is still grounded in a recommended pattern.
  if (hits.length === 0) {
    return referenceArchitectures.filter((ra) => ra.id === 'basic-web-app' || ra.id === 'serverless-web-app');
  }
  return hits;
}

/** Render retrieved architectures as grounding text for the system prompt. */
export function formatArchitecturesForPrompt(architectures: ReferenceArchitecture[]): string {
  return architectures
    .map(
      (ra) =>
        `- ${ra.name}: ${ra.summary}\n  Services: ${ra.services.join(', ')}\n  Reference: ${ra.docsUrl}`,
    )
    .join('\n');
}
