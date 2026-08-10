import { describe, expect, it } from 'vitest';
import {
  formatLearnGrounding,
  getLearnGrounding,
  parseLearnSearchContent,
} from './learnGrounding.js';

describe('learn grounding', () => {
  it('parses a JSON array of doc chunks', () => {
    const text = JSON.stringify([
      { title: 'App Service baseline', contentUrl: 'https://learn.microsoft.com/x', content: 'Use zone redundancy.' },
      { title: 'Key Vault', url: 'https://learn.microsoft.com/y', content: 'Store secrets.' },
    ]);
    const docs = parseLearnSearchContent([text]);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ title: 'App Service baseline', url: 'https://learn.microsoft.com/x' });
  });

  it('falls back to raw text when content is not JSON', () => {
    const docs = parseLearnSearchContent(['just some markdown text']);
    expect(docs[0]?.excerpt).toBe('just some markdown text');
  });

  it('dedupes by url', () => {
    const text = JSON.stringify([
      { title: 'A', url: 'https://learn.microsoft.com/same', content: 'one' },
      { title: 'A dup', url: 'https://learn.microsoft.com/same', content: 'two' },
    ]);
    expect(parseLearnSearchContent([text])).toHaveLength(1);
  });

  it('formats grounding text with titles and urls', () => {
    const text = formatLearnGrounding([
      { title: 'Baseline', url: 'https://learn.microsoft.com/z', excerpt: 'do this' },
    ]);
    expect(text).toContain('Baseline');
    expect(text).toContain('https://learn.microsoft.com/z');
  });

  it('returns empty string when there are no docs', () => {
    expect(formatLearnGrounding([])).toBe('');
  });

  it('is a no-op when grounding is disabled', async () => {
    const result = await getLearnGrounding({ enabled: false, endpoint: 'http://unused' }, 'a web app', []);
    expect(result).toBeNull();
  });

  it('soft-fails to null when the endpoint is unreachable', async () => {
    const result = await getLearnGrounding(
      { enabled: true, endpoint: 'http://127.0.0.1:9/mcp' },
      'a web app',
      [],
    );
    expect(result).toBeNull();
  });
});
