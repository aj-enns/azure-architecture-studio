import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { armResourcesToDiagram, type Diagram, type ImportResource } from '@aar/shared';

/**
 * Live Azure -> diagram import via Azure Resource Graph. Reads the resources in a
 * resource group and maps them deterministically (no model) using the shared
 * catalog-based type mapping. Auth uses the API host's ambient identity
 * (az login locally, managed identity in Azure), like Foundry model discovery.
 */

const MANAGEMENT_SCOPE = 'https://management.azure.com/.default';
const RESOURCE_GRAPH_URL =
  'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01';

export class AzureImportError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'AzureImportError';
  }
}

export interface ImportAzureDependencies {
  fetch?: typeof fetch;
  getManagementToken?: () => Promise<string>;
}

interface GraphRow {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  kind?: unknown;
  properties?: unknown;
}

interface GraphResponse {
  data?: unknown;
}

export async function importFromResourceGraph(
  params: { subscriptionId: string; resourceGroup: string; name?: string },
  deps: ImportAzureDependencies = {},
): Promise<Diagram> {
  const fetchImpl = deps.fetch ?? fetch;
  const getToken =
    deps.getManagementToken ??
    getBearerTokenProvider(new DefaultAzureCredential(), MANAGEMENT_SCOPE);

  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    throw new AzureImportError(
      `Failed to acquire an Azure token; sign in with az login or use a managed identity. ${
        err instanceof Error ? err.message : ''
      }`.trim(),
      401,
    );
  }

  // resourceGroup is validated by the route; single-quote for the KQL literal.
  const query = `Resources | where resourceGroup =~ '${params.resourceGroup}' | project id, name, type, kind, properties`;

  let response: Response;
  try {
    response = await fetchImpl(RESOURCE_GRAPH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subscriptions: [params.subscriptionId], query }),
    });
  } catch (err) {
    throw new AzureImportError(
      `Could not reach Azure Resource Graph: ${err instanceof Error ? err.message : 'network error'}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AzureImportError(
      `Azure Resource Graph returned ${response.status}. ${detail}`.trim(),
      response.status === 401 || response.status === 403 ? response.status : 502,
    );
  }

  const payload = (await response.json()) as GraphResponse;
  const rows = Array.isArray(payload.data) ? (payload.data as GraphRow[]) : [];

  const resources: ImportResource[] = rows
    .filter(
      (row): row is GraphRow => typeof row?.type === 'string' && typeof row?.name === 'string',
    )
    .map((row, index) => ({
      key: typeof row.id === 'string' ? row.id : `${row.type as string}#${index}`,
      type: row.type as string,
      name: row.name as string,
      ...(typeof row.kind === 'string' ? { kind: row.kind } : {}),
      ...(typeof row.id === 'string' ? { id: row.id } : {}),
      ...(row.properties !== undefined ? { properties: row.properties } : {}),
    }));

  return armResourcesToDiagram(resources, {
    name: params.name ?? `Azure: ${params.resourceGroup}`,
  });
}
