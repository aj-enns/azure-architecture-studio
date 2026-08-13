import { azureServiceCatalog } from '@aar/shared';
import type { Diagram } from '@aar/shared';

/**
 * Builds the system prompt for diagram generation. It enumerates the exact
 * catalog service ids the model may use, so it can only reference real services
 * (the server drops anything unknown as a second guard — ADR-0010). When
 * `grounding` is supplied (retrieved Azure Architecture Center patterns), the
 * model is told to adapt the closest recommended architecture.
 */
export type DesignMode = 'faithful' | 'bestPractice';

export function buildSystemPrompt(grounding?: string, mode: DesignMode = 'bestPractice'): string {
  const catalog = azureServiceCatalog
    .map((s) => `- ${s.id} (${s.name}, ${s.category}): ${s.description}`)
    .join('\n');

  const scopeRules =
    mode === 'faithful'
      ? `- Prefer the smallest set of services that satisfies the request; do not add
  resources the user did not ask for or imply.`
      : `- Design a production-ready, Well-Architected baseline. Beyond the services the
  user names, ADD the supporting services a competent Azure architect would
  include: a managed identity (and Microsoft Entra ID) for auth instead of keys,
  Key Vault for secrets, Application Insights and a Log Analytics workspace for
  monitoring, and for any internet-facing entry point a WAF via Application
  Gateway or Azure Front Door. Add a cache or messaging tier only when the
  workload implies it. Stay relevant to the request; do not invent unrelated
  workloads.
- Organize resources into a resource group, and use a virtual network with
  subnets when private networking, private endpoints, or a WAF are involved.`;

  const groundingSection = grounding
    ? `\n\nGround your design in these Azure Architecture Center recommended\narchitectures. Adapt the closest one to the user's request — reuse its service\nselection and topology, and apply Well-Architected Framework practices\n(managed identity over keys, Key Vault for secrets, private networking and\nmonitoring for production) — but never add services the user did not ask for or\nimply, and use ONLY catalog ids:\n${grounding}`
    : '';

  return `You are an Azure solution architect. Turn the user's description into an
architecture diagram as a JSON object matching the provided schema.

Rules:
- Use ONLY these catalog service ids for "serviceId". Never invent ids.
${scopeRules}
- Give each node a short, human "label" (e.g. "orders-api", "primary-db").
- Use groups to reflect real containment when it helps: resourceGroup for a
  logical grouping, vnet/subnet for network isolation, subscription for scope.
  Only create a group if at least one node belongs to it; set node.group to the
  group's key. Groups may nest: set a group's "parent" to another group's key to
  place it inside (e.g. subnet inside vnet inside resourceGroup inside
  subscription). Use "" for a top-level group.
- Add edges for meaningful connections (request flow, data access, integration).
  Point edges from caller/source to callee/target.
- Keys ("key", "from", "to", "group") are your own arbitrary unique strings used
  only to wire the graph; they are not shown to users.
- If the request is ambiguous, choose a sensible, common Azure pattern.

Available catalog services:
${catalog}${groundingSection}`;
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

/**
 * System prompt for image-to-diagram. The model transcribes an existing
 * architecture diagram image into the schema, mapping drawn boxes to catalog
 * service ids (nearest Azure equivalent for non-Azure elements; the server
 * drops anything unmappable — ADR-0010).
 */
export function buildImageSystemPrompt(mode: DesignMode = 'faithful'): string {
  const catalog = azureServiceCatalog
    .map((s) => `- ${s.id} (${s.name}, ${s.category}): ${s.description}`)
    .join('\n');

  const scopeRules =
    mode === 'faithful'
      ? `- Transcribe faithfully: include only what the image actually shows. Do not
  add supporting services the diagram does not depict.`
      : `- Transcribe what the image shows, then add the supporting services a
  competent Azure architect would include to make it a Well-Architected
  baseline (managed identity, Key Vault, Application Insights, Log Analytics).`;

  const nonAzureRule =
    mode === 'faithful'
      ? `- Map a component to an Azure service ONLY when it clearly IS that Azure
  service (identify by icon and label). For every other component that has no
  Azure equivalent (third-party SaaS, other clouds, on-premises systems, a
  browser or client, external data sources), KEEP it as a node with "serviceId"
  set to exactly "external" and use its drawn text as the "label". Never drop a
  component.`
      : `- Map each drawn component to the closest catalog service. Identify Azure
  services by their icon and label. For non-Azure elements (e.g. third-party
  SaaS, CDNs, on-premises, other clouds), map to the nearest Azure equivalent
  when one clearly fits; otherwise omit it rather than guessing.`;

  return `You are an Azure solution architect. Transcribe the architecture diagram in
the provided image into a JSON object matching the provided schema. Read the
boxes, icons, labels, arrows, and dashed boundaries in the image.

Rules:
- Use ONLY these catalog service ids for "serviceId", or the literal "external"
  for a non-Azure component. Never invent other ids.
${nonAzureRule}
${scopeRules}
- Preserve the diagram's labels: use the text next to each box as the node
  "label" (e.g. "orders-api", "SQL Database").
- Turn dashed/solid boundary boxes into groups: a virtual network box ->
  vnet, a subnet box -> subnet (parent = its vnet), a subscription boundary ->
  subscription, other labelled containers -> resourceGroup. Set node.group to
  the enclosing group's key; nest groups via "parent".
- Turn arrows and connector lines into edges, pointing from caller/source to
  callee/target. Use the arrow's text as the edge "label" when present.
- Keys ("key", "from", "to", "group") are your own arbitrary unique strings used
  only to wire the graph; they are not shown to users.

Available catalog services:
${catalog}`;
}

/** User message for image-to-diagram, optionally with the user's guidance. */
export function buildImageUserPrompt(guidance?: string): string {
  const base =
    'Transcribe the attached architecture diagram into the schema, following the rules.';
  const trimmed = guidance?.trim();
  return trimmed ? `${base}\n\nAdditional guidance:\n${trimmed}` : base;
}
