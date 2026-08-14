import { layoutDiagram } from './layout.js';
import { armResourcesToDiagram, armTemplateToDiagram, type ImportResource } from './importArm.js';
import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode } from './schema.js';

/**
 * Deterministic repo -> diagram import. Lightweight scanners extract Azure
 * resources and their references from Bicep (.bicep), Terraform (.tf), and ARM
 * (.json) files without a bicep/terraform CLI, then reuse the shared
 * catalog-based mapping. Bicep declares ARM resource types, so it reuses the ARM
 * type map directly; Terraform types are translated to ARM types first.
 */

/** A repository file to scan. */
export interface RepoFile {
  path: string;
  content: string;
}

// ---- Bicep ------------------------------------------------------------------

interface BicepDecl {
  symbol: string;
  type: string;
  existing: boolean;
  bodyStart: number;
  declStart: number;
}

/** Find the matching closing brace while ignoring braces in strings/comments. */
function findBicepBlockEnd(content: string, bodyStart: number): number {
  let depth = 1;
  let quote = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = bodyStart; i < content.length; i++) {
    const char = content[i]!;
    const next = content[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === "'" && next === "'") {
        i++;
      } else if (char === "'") {
        quote = false;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      i++;
    } else if (char === "'") {
      quote = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}' && --depth === 0) {
      return i;
    }
  }
  return content.length;
}

/** Read a top-level scalar property without matching nested objects like sku.name. */
function bicepTopLevelProperty(body: string, property: string): string | undefined {
  let depth = 0;
  let quote = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    const next = body[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === "'" && next === "'") {
        i++;
      } else if (char === "'") {
        quote = false;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (char === "'") {
      quote = true;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth++;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth--;
      continue;
    }
    if (depth !== 0 || body.slice(i, i + property.length) !== property) continue;
    const before = body[i - 1];
    const after = body[i + property.length];
    if ((before && /[A-Za-z0-9_]/.test(before)) || (after && /[A-Za-z0-9_]/.test(after))) continue;
    let cursor = i + property.length;
    while (/\s/.test(body[cursor] ?? '')) cursor++;
    if (body[cursor] !== ':') continue;
    cursor++;
    while (/\s/.test(body[cursor] ?? '') && body[cursor] !== '\n') cursor++;
    const lineEnd = body.indexOf('\n', cursor);
    const expression = body
      .slice(cursor, lineEnd === -1 ? body.length : lineEnd)
      .trim()
      .replace(/,$/, '');
    if (!expression) return undefined;
    const literal = /^'([\s\S]*)'$/.exec(expression);
    return literal?.[1]?.replace(/''/g, "'") ?? expression;
  }
  return undefined;
}

/** Extract Azure resources and their references from a Bicep file. */
export function parseBicepResources(content: string): ImportResource[] {
  const declRe =
    /\bresource\s+([A-Za-z_][A-Za-z0-9_]*)\s+'([^'@]+)@[^']+'\s*(existing\s*)?=\s*(?:if\s*\([^)]*\)\s*)?\{/g;
  const decls: BicepDecl[] = [];
  for (let m = declRe.exec(content); m; m = declRe.exec(content)) {
    decls.push({
      symbol: m[1]!,
      type: m[2]!,
      existing: Boolean(m[3]),
      declStart: m.index,
      bodyStart: declRe.lastIndex,
    });
  }
  if (decls.length === 0) return [];

  const symbols = new Set(decls.map((d) => d.symbol));

  return decls.map((decl, i) => {
    const body = content.slice(decl.bodyStart, findBicepBlockEnd(content, decl.bodyStart));
    const resourceName = bicepTopLevelProperty(body, 'name');
    const kind = bicepTopLevelProperty(body, 'kind');

    // Other symbols referenced in this resource's body imply a dependency edge.
    const dependsOn: string[] = [];
    for (const symbol of symbols) {
      if (symbol === decl.symbol) continue;
      if (new RegExp(`\\b${symbol}\\b`).test(body)) dependsOn.push(symbol);
    }

    return {
      key: decl.symbol,
      type: decl.type,
      name: resourceName ?? decl.symbol,
      ...(decl.existing ? { existing: true } : {}),
      ...(decl.type.toLowerCase() === 'microsoft.cognitiveservices/accounts' &&
      /foundry/i.test(`${decl.symbol} ${resourceName ?? ''}`)
        ? { serviceId: 'ai-foundry' }
        : {}),
      ...(kind ? { kind } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
    };
  });
}

export function bicepToDiagram(content: string, name?: string): Diagram {
  const resourceGroupScoped = /^\s*targetScope\s*=\s*'resourceGroup'\s*$/m.test(content);
  return armResourcesToDiagram(parseBicepResources(content), {
    ...(name ? { name } : {}),
    ...(resourceGroupScoped ? { resourceGroupLabel: 'Deployment resource group' } : {}),
  });
}

// ---- Terraform --------------------------------------------------------------

/** Terraform azurerm_* resource type -> ARM resource type (reuses the ARM map). */
const TERRAFORM_TO_ARM_TYPE: Record<string, string> = {
  azurerm_linux_virtual_machine: 'Microsoft.Compute/virtualMachines',
  azurerm_windows_virtual_machine: 'Microsoft.Compute/virtualMachines',
  azurerm_virtual_machine: 'Microsoft.Compute/virtualMachines',
  azurerm_linux_virtual_machine_scale_set: 'Microsoft.Compute/virtualMachineScaleSets',
  azurerm_windows_virtual_machine_scale_set: 'Microsoft.Compute/virtualMachineScaleSets',
  azurerm_orchestrated_virtual_machine_scale_set: 'Microsoft.Compute/virtualMachineScaleSets',
  azurerm_linux_function_app: 'Microsoft.Web/sites',
  azurerm_windows_function_app: 'Microsoft.Web/sites',
  azurerm_function_app: 'Microsoft.Web/sites',
  azurerm_linux_web_app: 'Microsoft.Web/sites',
  azurerm_windows_web_app: 'Microsoft.Web/sites',
  azurerm_app_service: 'Microsoft.Web/sites',
  azurerm_service_plan: 'Microsoft.Web/serverfarms',
  azurerm_app_service_plan: 'Microsoft.Web/serverfarms',
  azurerm_static_web_app: 'Microsoft.Web/staticSites',
  azurerm_container_app: 'Microsoft.App/containerApps',
  azurerm_container_app_environment: 'Microsoft.App/managedEnvironments',
  azurerm_kubernetes_cluster: 'Microsoft.ContainerService/managedClusters',
  azurerm_container_registry: 'Microsoft.ContainerRegistry/registries',
  azurerm_api_management: 'Microsoft.ApiManagement/service',
  azurerm_mssql_database: 'Microsoft.Sql/servers/databases',
  azurerm_sql_database: 'Microsoft.Sql/servers/databases',
  azurerm_cosmosdb_account: 'Microsoft.DocumentDB/databaseAccounts',
  azurerm_postgresql_flexible_server: 'Microsoft.DBforPostgreSQL/flexibleServers',
  azurerm_postgresql_server: 'Microsoft.DBforPostgreSQL/flexibleServers',
  azurerm_redis_cache: 'Microsoft.Cache/redisEnterprise',
  azurerm_redis_enterprise_cluster: 'Microsoft.Cache/redisEnterprise',
  azurerm_storage_account: 'Microsoft.Storage/storageAccounts',
  azurerm_virtual_network: 'Microsoft.Network/virtualNetworks',
  azurerm_lb: 'Microsoft.Network/loadBalancers',
  azurerm_application_gateway: 'Microsoft.Network/applicationGateways',
  azurerm_cdn_frontdoor_profile: 'Microsoft.Cdn/profiles',
  azurerm_frontdoor: 'Microsoft.Cdn/profiles',
  azurerm_private_endpoint: 'Microsoft.Network/privateEndpoints',
  azurerm_cognitive_account: 'Microsoft.CognitiveServices/accounts',
  azurerm_search_service: 'Microsoft.Search/searchServices',
  azurerm_machine_learning_workspace: 'Microsoft.MachineLearningServices/workspaces',
  azurerm_eventhub_namespace: 'Microsoft.EventHub/namespaces',
  azurerm_kusto_cluster: 'Microsoft.Kusto/clusters',
  azurerm_servicebus_namespace: 'Microsoft.ServiceBus/namespaces',
  azurerm_key_vault: 'Microsoft.KeyVault/vaults',
  azurerm_user_assigned_identity: 'Microsoft.ManagedIdentity/userAssignedIdentities',
  azurerm_log_analytics_workspace: 'Microsoft.OperationalInsights/workspaces',
  azurerm_application_insights: 'Microsoft.Insights/components',
};

interface TfDecl {
  tfType: string;
  name: string;
  declStart: number;
  bodyStart: number;
}

/** Extract Azure resources and their references from a Terraform file. */
export function parseTerraformResources(content: string): ImportResource[] {
  const declRe = /\bresource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  const boundaryRe = /\b(resource|data|module|variable|output|provider|locals|terraform)\b/g;
  const decls: TfDecl[] = [];
  for (let m = declRe.exec(content); m; m = declRe.exec(content)) {
    decls.push({ tfType: m[1]!, name: m[2]!, declStart: m.index, bodyStart: declRe.lastIndex });
  }
  if (decls.length === 0) return [];

  const azureDecls = decls.filter((d) => d.tfType.startsWith('azurerm_'));
  const keys = new Set(azureDecls.map((d) => `${d.tfType}.${d.name}`));

  return azureDecls.map((decl) => {
    // Body ends at the next top-level block keyword after this declaration.
    boundaryRe.lastIndex = decl.bodyStart;
    const next = boundaryRe.exec(content);
    const body = content.slice(decl.bodyStart, next?.index ?? content.length);
    const nameMatch = /\bname\s*=\s*"([^"]+)"/.exec(body);

    const selfKey = `${decl.tfType}.${decl.name}`;
    const dependsOn: string[] = [];
    for (const key of keys) {
      if (key === selfKey) continue;
      if (new RegExp(`\\b${key.replace('.', '\\.')}\\b`).test(body)) dependsOn.push(key);
    }

    return {
      key: selfKey,
      type: TERRAFORM_TO_ARM_TYPE[decl.tfType] ?? decl.tfType,
      name: nameMatch?.[1] ?? decl.name,
      ...(decl.tfType.includes('function_app') ? { kind: 'functionapp' } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
    };
  });
}

export function terraformToDiagram(content: string, name?: string): Diagram {
  return armResourcesToDiagram(parseTerraformResources(content), name ? { name } : {});
}

// ---- ARM detection + repo scan ---------------------------------------------

function isArmTemplate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as { $schema?: unknown; resources?: unknown };
  if (!('resources' in obj)) return false;
  if (typeof obj.$schema === 'string' && /deploymenttemplate/i.test(obj.$schema)) return true;
  if (Array.isArray(obj.resources)) {
    return obj.resources.some((r) => typeof (r as { type?: unknown })?.type === 'string');
  }
  return typeof obj.resources === 'object';
}

/** Parse one repository file into a diagram, or null if unsupported/empty. */
function fileToDiagram(file: RepoFile): Diagram | null {
  const lower = file.path.toLowerCase();
  let diagram: Diagram | null = null;
  if (lower.endsWith('.bicep')) {
    diagram = bicepToDiagram(file.content, file.path);
  } else if (lower.endsWith('.tf')) {
    diagram = terraformToDiagram(file.content, file.path);
  } else if (lower.endsWith('.json')) {
    try {
      const json = JSON.parse(file.content);
      if (isArmTemplate(json)) diagram = armTemplateToDiagram(json, { name: file.path });
    } catch {
      return null;
    }
  }
  return diagram && diagram.nodes.length > 0 ? diagram : null;
}

/** Merge per-file diagrams into one, namespacing ids to avoid collisions. */
function mergeDiagrams(diagrams: Diagram[], name: string): Diagram {
  const nodes: DiagramNode[] = [];
  const groups: DiagramGroup[] = [];
  const edges: DiagramEdge[] = [];
  const coalescedGroups = new Map<string, string>();
  diagrams.forEach((diagram, i) => {
    const groupIds = new Map<string, string>();
    for (const group of diagram.groups) {
      const coalesceKey =
        !group.parentId && group.kind === 'resourceGroup'
          ? `${group.kind}:${group.label}`
          : undefined;
      const existingId = coalesceKey ? coalescedGroups.get(coalesceKey) : undefined;
      const id = existingId ?? `f${i}_${group.id}`;
      groupIds.set(group.id, id);
      if (existingId) continue;
      if (coalesceKey) coalescedGroups.set(coalesceKey, id);
      groups.push({
        ...group,
        id,
        position: { x: 0, y: 0 },
        ...(group.parentId ? { parentId: `f${i}_${group.parentId}` } : {}),
      });
    }
    diagram.nodes.forEach((node) => {
      nodes.push({
        ...node,
        id: `f${i}_${node.id}`,
        position: { x: 0, y: 0 },
        ...(node.parentId
          ? { parentId: groupIds.get(node.parentId) ?? `f${i}_${node.parentId}` }
          : {}),
      });
    });
    diagram.edges.forEach((edge) => {
      edges.push({
        id: `f${i}_${edge.id}`,
        source: `f${i}_${edge.source}`,
        target: `f${i}_${edge.target}`,
        ...(edge.label ? { label: edge.label } : {}),
      });
    });
  });

  return layoutDiagram({
    version: 1,
    metadata: {
      name,
      description: 'Imported deterministically from repository IaC.',
      region: 'eastus2',
    },
    nodes,
    groups,
    edges,
  });
}

/**
 * Scan a set of repository files (Bicep/Terraform/ARM), map each deterministically,
 * and merge them into one architecture diagram.
 */
export function scanRepoFiles(files: RepoFile[], name = 'Imported repository'): Diagram {
  const diagrams = files
    .map((file) => fileToDiagram(file))
    .filter((diagram): diagram is Diagram => diagram !== null);
  return mergeDiagrams(diagrams, name);
}

/** True when a path is worth sending to the scanner. */
export function isScannableIacPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith('.bicep') || lower.endsWith('.tf')) return true;
  if (!lower.endsWith('.json')) return false;
  return (
    /(azuredeploy|deploy\.json$|template\.json$|\.arm\.json$)/i.test(lower) ||
    /(^|\/)(arm|templates?)\//i.test(lower)
  );
}
