import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDiagram } from './api.js';

describe('generateDiagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns a browser fetch failure into an actionable connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(generateDiagram('Add a private endpoint')).rejects.toThrow(
      'The connection to the API was interrupted. Try again; if this continues, check the Azure API and web proxy.',
    );
  });
});