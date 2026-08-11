import { z } from 'zod';
import {
  analyzeResiliency,
  estimateDiagramCost,
  getServiceDefinition,
  validateArchitecture,
  type Diagram,
} from '@aar/shared';
import { formatLearnGrounding, searchLearnDocsCached, type LearnDoc } from './learnGrounding.js';
import { AiGenerationError, generateJson } from './openai.js';
import { summarizeDiagram } from './prompt.js';
import type { AzureOpenAIConfig } from '../config.js';

const MAX_LEARN_QUERIES = 4;

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
}

const advisorResponseSchema = z.object({
  markdown: z.string().min(1),
  diagramPrompt: z.string().min(1).nullable(),
});

const advisorJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    markdown: {
      type: 'string',
      description: 'A concise architecture answer in GitHub-flavoured Markdown.',
    },
    diagramPrompt: {
      type: ['string', 'null'],
      description:
        'A self-contained instruction for revising the current diagram, or null when no diagram change is warranted.',
    },
  },
  required: ['markdown', 'diagramPrompt'],
} as const;

export const ADVISOR_SYSTEM_PROMPT = `You are a senior Microsoft Azure solution architect answering
questions about the user's current architecture. Answer the question directly, then explain the
decision using the supplied topology and deterministic analysis.

Rules:
- Treat the LATEST DIAGRAM in the user message as authoritative. Conversation history is context
  only and may describe an older design.
- If the diagram is empty or lacks information needed for a firm recommendation, state the key
  assumptions or ask for the smallest missing detail. You may still answer general Azure questions.
- Compare relevant Azure options when useful. For traffic distribution, distinguish Azure Load Balancer
  (Layer 4) from Application Gateway (Layer 7) and global Azure Front Door rather than treating
  them as interchangeable.
- Frame recommendations as reliability, security, performance, operational, and cost trade-offs.
- Use deterministic WAF, resiliency, and cost results as supplied. Do not recompute or invent SLA,
  RTO, RPO, or pricing figures. Treat planning figures as non-contractual.
- Microsoft Learn excerpts, when supplied, are the only external grounding. Do not invent sources.
- Never claim to have changed the diagram and never instruct the UI to change it automatically.
- Return concise GitHub-flavoured Markdown in "markdown" with no heading unless one improves a
  longer answer.
- Set "diagramPrompt" to null unless a concrete topology change follows from the answer. When a
  change is warranted, provide one concise, self-contained instruction that tells the diagram
  generator how to revise the current architecture. Do not include internal node ids or positions.`;

/** Builds a single user message for the stateless advisor call. */
export function buildAdvisorUserPrompt(
  diagram: Diagram,
  message: string,
  history: AdvisorMessage[],
  grounding: string,
): string {
  const transcript = history.length
    ? history.map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`).join('\n\n')
    : 'No earlier turns.';
  const topology = summarizeDiagram(diagram);
  const waf = validateArchitecture(diagram);
  const resiliency = analyzeResiliency(diagram);
  const cost = estimateDiagramCost(diagram);

  return `Conversation history (context only):
${transcript}

LATEST DIAGRAM (authoritative):
Region: ${diagram.metadata.region}
Topology: ${topology}

Deterministic Well-Architected analysis:
${JSON.stringify(waf)}

Deterministic resiliency analysis:
${JSON.stringify(resiliency)}

Deterministic monthly cost estimate:
${JSON.stringify(cost)}

Current question:
${message}${grounding ? `\n\n${grounding}` : ''}`;
}

async function groundAdvice(
  learnConfig: { enabled: boolean; endpoint: string },
  diagram: Diagram,
  message: string,
): Promise<{ text: string; citations: LearnDoc[]; groundingError?: string }> {
  if (!learnConfig.enabled) return { text: '', citations: [] };

  const serviceNames = [...new Set(diagram.nodes.map((node) => node.serviceId))]
    .map((id) => getServiceDefinition(id)?.name)
    .filter((name): name is string => !!name)
    .slice(0, MAX_LEARN_QUERIES - 1);
  const queries = [
    `Azure architecture guidance ${message}`,
    ...serviceNames.map((name) => `${name} architecture reliability best practices`),
  ];

  try {
    const results = await searchLearnDocsCached(queries, learnConfig.endpoint);
    const seen = new Set<string>();
    const citations = results.flat().filter((doc) => {
      const key = doc.url || doc.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return citations.length > 0
      ? { text: formatLearnGrounding(citations), citations }
      : {
          text: '',
          citations: [],
          groundingError: 'Could not retrieve Microsoft Learn references; the answer uses the built-in analysis only.',
        };
  } catch {
    return {
      text: '',
      citations: [],
      groundingError: 'Could not retrieve Microsoft Learn references; the answer uses the built-in analysis only.',
    };
  }
}

export interface ArchitectureAdvice {
  markdown: string;
  diagramPrompt: string | null;
  citations: LearnDoc[];
  groundingError?: string;
}

/** Answers an architecture question without mutating the supplied diagram. */
export async function adviseArchitecture(
  aiConfig: AzureOpenAIConfig,
  learnConfig: { enabled: boolean; endpoint: string },
  diagram: Diagram,
  message: string,
  history: AdvisorMessage[],
): Promise<ArchitectureAdvice> {
  const grounding = await groundAdvice(learnConfig, diagram, message);
  const json = await generateJson(
    aiConfig,
    ADVISOR_SYSTEM_PROMPT,
    buildAdvisorUserPrompt(diagram, message, history, grounding.text),
    { name: 'azure_architecture_advice', jsonSchema: advisorJsonSchema },
  );
  const parsed = advisorResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiGenerationError('The model returned an unexpected advisor response.', 502);
  }

  return {
    ...parsed.data,
    citations: grounding.citations,
    ...(grounding.groundingError ? { groundingError: grounding.groundingError } : {}),
  };
}