import { describe, expect, it } from 'vitest';
import { azureServiceCatalog } from '@aar/shared';
import { buildImageSystemPrompt, buildImageUserPrompt } from './prompt.js';

describe('image prompt builders', () => {
  it('enumerates catalog ids and describes transcription rules', () => {
    const prompt = buildImageSystemPrompt('faithful');
    expect(prompt).toContain('Transcribe');
    expect(prompt).toContain(azureServiceCatalog[0]!.id);
  });

  it('keeps named non-Azure products as "external" in both modes', () => {
    for (const mode of ['faithful', 'bestPractice'] as const) {
      const prompt = buildImageSystemPrompt(mode);
      expect(prompt).toContain('"external"');
      expect(prompt).toContain('Never drop a');
      // A named product must not be mapped to an Azure equivalent.
      expect(prompt).toContain('Salesforce');
    }
  });

  it('includes user guidance when provided', () => {
    expect(buildImageUserPrompt('treat the dashed box as a VNet')).toContain(
      'treat the dashed box as a VNet',
    );
    expect(buildImageUserPrompt()).not.toContain('Additional guidance');
  });
});
