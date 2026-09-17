import { z } from 'zod';
import {
  analyzeResiliency,
  estimateDiagramCost,
  getServiceDefinition,
  validateArchitecture,
  type Diagram,
} from '@aas/shared';
import { formatLearnGrounding, searchLearnDocsCached, type LearnDoc } from './learnGrounding.js';
import { AiGenerationError, generateJson } from './openai.js';
import { summarizeDiagram } from './prompt.js';
import type { AzureOpenAIConfig } from '../config.js';

/** Cap Learn queries so a review can't fan out into many MCP round trips. */
const MAX_LEARN_QUERIES = 5;

const reviewResponseSchema = z.object({ markdown: z.string().min(1) });

const reviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    markdown: {
      type: 'string',
      description: 'The full review as GitHub-flavoured Markdown, following the required sections.',
    },
  },
  required: ['markdown'],
} as const;

/**
 * The review methodology, encoding the `waf-architecture-review` skill as a
 * system prompt so the running app produces the same review the Copilot skill
 * would. Keep this in sync with .github/skills/waf-architecture-review/SKILL.md
 * (ADR-0014). The model reasons over deterministic analysis supplied in the user
 * message; it must not invent figures.
 */
const SYSTEM_PROMPT = `You are a senior Microsoft cloud solution architect reviewing a customer's Azure
design against the Well-Architected Framework, then stress-testing its resiliency and
disaster-recovery posture. Be supportive in tone but keep the DESIGN at the forefront:
name real risks plainly and frame every recommendation as a cost-versus-uptime trade-off
the customer can decide on.

Grounding rules:
- Reason ONLY over the analysis provided in the user message (WAF findings, resiliency
  report, cost estimate) and any Microsoft Learn excerpts supplied. Do NOT invent PUBLISHED
  SLA, RTO, or RPO numbers, and never present any figure as contractual. Where a published
  per-service RTO/RPO is not provided, say "not published" - but you MAY offer a clearly
  labelled ESTIMATED recovery window derived from the design's resilience tier and failure
  walk (see the recovery-window section). Prefer any published figures from the resiliency
  report over an estimate.
- Composite SLA is the multiplicative product of request-path components; the weakest link
  is the actionable lever. These are already computed - cite them, don't recompute.
- Published SLA coverage is narrower than a whole service, so a realistic SLO is usually
  lower than the SLA. Note this where it matters.
- Zone redundancy requires all three of: an availability-zone region, a service/SKU that
  supports it, and the configuration enabling it. The resiliency report already flags
  gate failures - surface them.
- Right-size recommendations to the workload's criticality; do not demand five-nines by default.
- Nodes whose serviceId is "external" (or "external:*") are non-Azure components with no known
  cost or SLA; the cost total and composite SLA already EXCLUDE them (marked with a "*"). Do not
  assign them a cost or availability figure, but DO call out that an unmeasured external dependency
  on the request path can limit real availability.

Output rules:
- Respond with GitHub-flavoured Markdown in the "markdown" field. No preamble outside it.
- Use exactly these sections, in order:
  ## Summary - 2-3 sentences: overall posture, the single biggest risk, headline composite SLA / downtime per month, and whether it meets any stated target.
  ## Pillar scorecard - a Markdown table: Pillar | Verdict (Strong / Adequate / At risk) | Top finding. Cover all five pillars: Reliability, Security, Cost Optimization, Operational Excellence, Performance Efficiency.
  ## Resiliency & DR - composite SLA and downtime/month, the weakest link and why, zone-redundancy gaps, and a short component / zone / region failure walk.
  ## Estimated recovery window (RPO/RTO) - give an ESTIMATED RPO and RTO range for the design as a whole, derived from its resilience tier and the failure walk. Use these bands as a starting point: nonzonal single-region ~ RTO hours / RPO back to last backup; zone-redundant single-region ~ RTO minutes / RPO seconds; active-passive paired-region ~ RTO minutes-to-hours / RPO replication lag; active-active multi-region ~ RTO seconds / RPO near-zero. Prefer any published per-service figures from the resiliency report where present. If there is no DR target region, state the region-loss RTO is bounded by region-rebuild time. Open the section by stating plainly that this is a planning ESTIMATE, NOT an authoritative or contractual objective, and that the customer's own infrastructure - backup cadence, replication configuration, failover automation, tested runbooks, and app-level retry - will move these numbers materially.
  ## Prioritized recommendations - a numbered list ordered by risk-reduction per dollar. Prefix each with [Critical], [Recommended], or [Optional]. Each states current -> proposed availability, the failure mode closed, and a rough monthly cost delta (label estimates as estimates).
  ## Sources - bullet list of the Microsoft Learn URLs used, if any.
- End with one italic line noting figures are representative planning inputs, not a contractual SLA.`;

function buildUserPrompt(
  diagram: Diagram,
  waf: unknown,
  resiliency: unknown,
  cost: unknown,
  grounding: string,
): string {
  const target = diagram.metadata.resiliency
    ? `Target: SLA ${diagram.metadata.resiliency.slaPercent}%, RTO ${diagram.metadata.resiliency.rtoMinutes} min, RPO ${diagram.metadata.resiliency.rpoMinutes} min.`
    : 'No explicit SLA/RTO/RPO target set - infer a reasonable bar from the workload and say so.';

  return `Review this Azure architecture.

Region: ${diagram.metadata.region}
${target}

Topology:
${summarizeDiagram(diagram)}

Well-Architected Framework analysis (deterministic):
${JSON.stringify(waf)}

Resiliency & DR analysis (deterministic - composite SLA, weakest link, zone-redundancy gates):
${JSON.stringify(resiliency)}

Monthly cost estimate (deterministic, representative):
${JSON.stringify(cost)}${grounding ? `\n\n${grounding}` : ''}`;
}

/** Best-effort Learn grounding: reference guidance for the design's services. */
async function groundReview(
  learnConfig: { enabled: boolean; endpoint: string },
  diagram: Diagram,
): Promise<{ text: string; citations: LearnDoc[] }> {
  if (!learnConfig.enabled) return { text: '', citations: [] };

  const serviceNames = [...new Set(diagram.nodes.map((n) => n.serviceId))]
    .map((id) => getServiceDefinition(id)?.name)
    .filter((n): n is string => !!n)
    .slice(0, MAX_LEARN_QUERIES - 1);

  const queries = [
    'Azure Well-Architected Framework reliability reference architecture',
    ...serviceNames.map((name) => `${name} reliability best practices availability zones`),
  ];

  try {
    const perQuery = await searchLearnDocsCached(queries, learnConfig.endpoint);
    const seen = new Set<string>();
    const citations: LearnDoc[] = [];
    for (const doc of perQuery.flat()) {
      const key = doc.url || doc.title;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(doc);
    }
    return { text: formatLearnGrounding(citations), citations };
  } catch {
    return { text: '', citations: [] };
  }
}

export interface ArchitectureReview {
  markdown: string;
  citations: LearnDoc[];
  /** Set when grounding was requested but could not complete. */
  groundingError?: string;
}

/**
 * Produce a Well-Architected + resiliency review of a diagram. Runs the
 * deterministic analyses, optionally grounds them with Microsoft Learn, and asks
 * the model to synthesise a review using the skill methodology. Throws
 * AiGenerationError on model failure so the route can map the status.
 */
export async function reviewArchitecture(
  aiConfig: AzureOpenAIConfig,
  learnConfig: { enabled: boolean; endpoint: string },
  diagram: Diagram,
  grounded: boolean,
): Promise<ArchitectureReview> {
  const waf = validateArchitecture(diagram);
  const resiliency = analyzeResiliency(diagram);
  const cost = estimateDiagramCost(diagram);

  let grounding = { text: '', citations: [] as LearnDoc[] };
  let groundingError: string | undefined;
  if (grounded) {
    grounding = await groundReview(learnConfig, diagram);
    if (grounding.citations.length === 0) {
      groundingError =
        'Could not retrieve Microsoft Learn references; the review uses the built-in analysis only.';
    }
  }

  const json = await generateJson(
    aiConfig,
    SYSTEM_PROMPT,
    buildUserPrompt(diagram, waf, resiliency, cost, grounding.text),
    { name: 'azure_architecture_review', jsonSchema: reviewJsonSchema },
  );

  const parsed = reviewResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiGenerationError('The model returned an unexpected review shape.', 502);
  }

  return { markdown: parsed.data.markdown, citations: grounding.citations, groundingError };
}
