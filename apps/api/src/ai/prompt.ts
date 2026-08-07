import { azureServiceCatalog } from '@aar/shared';
import type { Diagram } from '@aar/shared';

/**
 * Builds the system prompt for diagram generation. It enumerates the exact
 * catalog service ids the model may use, so it can only reference real services
 * (the server drops anything unknown as a second guard — ADR-0010).
 */
export function buildSystemPrompt(): string {
  const catalog = azureServiceCatalog
    .map((s) => `- ${s.id} (${s.name}, ${s.category}): ${s.description}`)
    .join('\n');

  return `You are an Azure solution architect. Turn the user's description into an
architecture diagram as a JSON object matching the provided schema.

Rules:
- Use ONLY these catalog service ids for "serviceId". Never invent ids.
- Prefer the smallest set of services that satisfies the request; do not add
  resources the user did not ask for or imply.
- Give each node a short, human "label" (e.g. "orders-api", "primary-db").
- Use groups to reflect real containment when it helps: resourceGroup for a
  logical grouping, vnet/subnet for network isolation, subscription for scope.
  Only create a group if at least one node belongs to it; set node.group to the
  group's key.
- Add edges for meaningful connections (request flow, data access, integration).
  Point edges from caller/source to callee/target.
- Keys ("key", "from", "to", "group") are your own arbitrary unique strings used
  only to wire the graph; they are not shown to users.
- If the request is ambiguous, choose a sensible, common Azure pattern.

Available catalog services:
${catalog}`;
}

/** Builds the user message, optionally including the current diagram as context. */
export function buildUserPrompt(prompt: string, currentSummary?: string): string {
  if (!currentSummary) return prompt;
  return `Current diagram (for context; extend or revise it):
${currentSummary}

Request:
${prompt}`;
}

/** Compact, human-readable summary of a diagram used as model context. */
export function summarizeDiagram(diagram: Diagram): string {
  if (diagram.nodes.length === 0) return 'empty';
  const nodes = diagram.nodes
    .map((n) => `${n.label || n.serviceId} [${n.serviceId}]`)
    .join(', ');
  const edges = diagram.edges
    .map((e) => {
      const from = diagram.nodes.find((n) => n.id === e.source)?.label ?? e.source;
      const to = diagram.nodes.find((n) => n.id === e.target)?.label ?? e.target;
      return `${from} -> ${to}`;
    })
    .join(', ');
  return `nodes: ${nodes}${edges ? `\nedges: ${edges}` : ''}`;
}
