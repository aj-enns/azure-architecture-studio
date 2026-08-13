import { describe, expect, it } from 'vitest';
import { azureServiceCatalog } from '@aar/shared';
import { buildImageSystemPrompt, buildImageUserPrompt } from './prompt.js';

describe('image prompt builders', () => {
  it('enumerates catalog ids and describes transcription rules', () => {
    const prompt = buildImageSystemPrompt('faithful');
    expect(prompt).toContain('Transcribe');
    expect(prompt).toContain(azureServiceCatalog[0]!.id);
  });

  it('keeps unmapped items as "external" in faithful mode, maps them in best-practice', () => {
    const faithful = buildImageSystemPrompt('faithful');
    expect(faithful).toContain('"external"');
    expect(faithful).toContain('Never drop a');

    const bestPractice = buildImageSystemPrompt('bestPractice');
    expect(bestPractice).toContain('nearest Azure equivalent');
  });

  it('includes user guidance when provided', () => {
    expect(buildImageUserPrompt('treat the dashed box as a VNet')).toContain(
      'treat the dashed box as a VNet',
    );
    expect(buildImageUserPrompt()).not.toContain('Additional guidance');
  });
});
