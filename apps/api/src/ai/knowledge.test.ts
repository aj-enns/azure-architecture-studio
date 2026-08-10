import { describe, expect, it } from 'vitest';
import {
  formatArchitecturesForPrompt,
  retrieveArchitectures,
  validateReferenceArchitectures,
} from './knowledge.js';

describe('reference architecture knowledge base', () => {
  it('only references catalog service ids', () => {
    expect(validateReferenceArchitectures()).toEqual([]);
  });

  it('retrieves the OpenAI chat pattern for an LLM prompt', () => {
    const hits = retrieveArchitectures('a chatbot using GPT with RAG over my docs');
    expect(hits[0]?.id).toBe('baseline-openai-chat');
  });

  it('retrieves the event-processing pattern for a streaming prompt', () => {
    const hits = retrieveArchitectures('ingest a real-time event stream and store it');
    expect(hits.map((h) => h.id)).toContain('serverless-event-processing');
  });

  it('falls back to common patterns when nothing matches', () => {
    const hits = retrieveArchitectures('zzzzzz qqqqqq');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('formats grounding text with services and a reference URL', () => {
    const text = formatArchitecturesForPrompt(retrieveArchitectures('kubernetes cluster'));
    expect(text).toContain('Services:');
    expect(text).toContain('https://learn.microsoft.com/azure/architecture/');
  });
});
