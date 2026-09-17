import { z } from 'zod';
import {
  getServiceDefinition,
  type Diagram,
  type ResilienceTier,
  type SlaProfile,
} from '@aas/shared';
import { formatLearnGrounding, searchLearnDocsCached, type LearnDoc } from './learnGrounding.js';
import { AiGenerationError, generateJson } from './openai.js';
import type { AzureOpenAIConfig } from '../config.js';

/** Cap the fan-out so a large diagram can't turn into dozens of MCP round trips. */
const MAX_SERVICES = 12;

const tierEnum = ['global', 'nonzonal', 'zoneRedundant', 'multiRegion'] as const;

const groundedProfileSchema = z.object({
  serviceId: z.string().min(1),
  tier: z.enum(tierEnum),
  slaPercent: z.number().min(0).max(100),
  /** -1 means the docs do not publish a figure. */
  rtoMinutes: z.number(),
  rpoMinutes: z.number(),
  basis: z.string(),
  sourceUrl: z.string(),
  confidence: z.enum(['published', 'derived', 'estimated']),
});

const groundedResponseSchema = z.object({ profiles: z.array(groundedProfileSchema) });

/**
 * Hand-synced with `groundedResponseSchema`. Structured outputs in strict mode
 * require every property in `required` and `additionalProperties: false`, so
 * "not published" is expressed as -1 rather than null.
 */
const groundedJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profiles: {
      type: 'array',
      description: 'One entry per service and achievable resilience tier.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serviceId: { type: 'string', description: 'MUST be one of the requested catalog ids.' },
          tier: { type: 'string', enum: [...tierEnum] },
          slaPercent: { type: 'number', description: 'Uptime percentage, e.g. 99.99.' },
          rtoMinutes: {
            type: 'number',
            description: 'Recovery time in minutes, or -1 if unpublished.',
          },
          rpoMinutes: {
            type: 'number',
            description: 'Recovery point in minutes, or -1 if unpublished.',
          },
          basis: { type: 'string', description: 'What the figure covers, and any caveat.' },
          sourceUrl: { type: 'string', description: 'Microsoft Learn URL the figure came from.' },
          confidence: { type: 'string', enum: ['published', 'derived', 'estimated'] },
        },
        required: [
          'serviceId',
          'tier',
          'slaPercent',
          'rtoMinutes',
          'rpoMinutes',
          'basis',
          'sourceUrl',
          'confidence',
        ],
      },
    },
  },
  required: ['profiles'],
} as const;

const SYSTEM_PROMPT = `You are an Azure reliability analyst. From the supplied Microsoft Learn
documentation, extract the availability and recovery figures for each requested Azure service.

Rules:
- Use ONLY the supplied documentation. Never recall figures from memory.
- Use ONLY the catalog service ids given in the request for "serviceId".
- Emit one entry per tier the documentation actually supports:
  "nonzonal" (single-zone/default), "zoneRedundant" (availability zones),
  "multiRegion" (cross-region failover), or "global" for services with no regional scope.
- "slaPercent" is the uptime commitment for that configuration.
- Microsoft publishes RTO and RPO for only a few services. Use -1 for either when the
  documentation does not state a figure. Never estimate a recovery objective.
- "sourceUrl" must be a URL that appears in the supplied documentation.
- "confidence": "published" when the document states the number outright, "derived" when you
  computed or inferred it from stated behaviour, "estimated" otherwise.
- If the documentation says nothing useful about a service, omit it entirely.`;

function buildQuery(serviceId: string): string {
  const name = getServiceDefinition(serviceId)?.name ?? serviceId;
  return `${name} reliability SLA availability zones zone redundancy RTO RPO`;
}

function toSlaProfile(raw: z.infer<typeof groundedProfileSchema>, retrievedAt: string): SlaProfile {
  return {
    serviceId: raw.serviceId,
    tier: raw.tier as ResilienceTier,
    slaPercent: raw.slaPercent,
    rtoMinutes: raw.rtoMinutes < 0 ? null : raw.rtoMinutes,
    rpoMinutes: raw.rpoMinutes < 0 ? null : raw.rpoMinutes,
    basis: raw.basis,
    source: {
      kind: 'learn',
      url: raw.sourceUrl || undefined,
      retrievedAt,
      confidence: raw.confidence,
    },
  };
}

export interface GroundedResiliency {
  profiles: SlaProfile[];
  citations: LearnDoc[];
}

/**
 * Refreshes the shared baseline SLA table from Microsoft Learn. Retrieves the
 * per-service reliability guides over one MCP session, then extracts structured
 * figures in a single model call. Throws AiGenerationError on model failure so
 * the route can report it without losing the deterministic baseline.
 */
export async function groundResiliency(
  aiConfig: AzureOpenAIConfig,
  learnConfig: { enabled: boolean; endpoint: string },
  diagram: Diagram,
): Promise<GroundedResiliency> {
  if (!learnConfig.enabled) return { profiles: [], citations: [] };

  const serviceIds = [...new Set(diagram.nodes.map((n) => n.serviceId))]
    .filter((id) => getServiceDefinition(id))
    .slice(0, MAX_SERVICES);
  if (serviceIds.length === 0) return { profiles: [], citations: [] };

  const docsPerService = await searchLearnDocsCached(
    serviceIds.map(buildQuery),
    learnConfig.endpoint,
  );
  const citations = dedupeCitations(docsPerService.flat());
  if (citations.length === 0) return { profiles: [], citations: [] };

  const sections = serviceIds
    .map((id, i) => {
      const docs = docsPerService[i] ?? [];
      if (docs.length === 0) return '';
      const name = getServiceDefinition(id)?.name ?? id;
      return `## ${name} (serviceId: ${id})\n${formatLearnGrounding(docs)}`;
    })
    .filter(Boolean)
    .join('\n\n');
  if (!sections) return { profiles: [], citations };

  const json = await generateJson(
    aiConfig,
    SYSTEM_PROMPT,
    `Extract availability and recovery figures for these services:\n\n${sections}`,
    { name: 'azure_service_resiliency', jsonSchema: groundedJsonSchema },
  );

  const parsed = groundedResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiGenerationError(
      `Model output did not match the resiliency schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      502,
    );
  }

  const retrievedAt = new Date().toISOString();
  const allowed = new Set(serviceIds);
  return {
    profiles: parsed.data.profiles
      .filter((p) => allowed.has(p.serviceId))
      .map((p) => toSlaProfile(p, retrievedAt)),
    citations,
  };
}

function dedupeCitations(docs: LearnDoc[]): LearnDoc[] {
  const seen = new Set<string>();
  const out: LearnDoc[] = [];
  for (const d of docs) {
    const key = d.url || d.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
