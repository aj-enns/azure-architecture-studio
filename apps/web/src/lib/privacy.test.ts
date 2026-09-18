import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consentKey,
  describeAction,
  privacyFetch,
  resetConsent,
  resolveConsent,
  usePrivacyStore,
  type PrivacyHealth,
} from './privacy.js';

const health: PrivacyHealth = {
  status: 'ok',
  aiConfigured: true,
  iacImportEnabled: true,
  privacy: { mode: 'self-hosted', aiHost: 'model.example.com', learnHost: 'learn.microsoft.com' },
};

afterEach(() => {
  resolveConsent(false);
  resetConsent();
  usePrivacyStore.setState({ health: null, pending: null, lastTransfer: null });
  vi.unstubAllGlobals();
});

describe('privacy', () => {
  it('changes remembered consent when destinations or grounding change', () => {
    const original = describeAction('review', health, 'app.example.com');
    expect(consentKey(original)).not.toBe(
      consentKey(describeAction('review', health, 'app.example.com', false)),
    );
    expect(consentKey(original)).not.toBe(
      consentKey(
        describeAction(
          'review',
          { ...health, privacy: { ...health.privacy, aiHost: 'other.example.com' } },
          'app.example.com',
        ),
      ),
    );
  });

  it('does not send the payload when consent is cancelled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(health)));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { host: 'app.example.com' } });
    const result = privacyFetch('review', '/api/review', {
      method: 'POST',
      body: '{"diagram":{}}',
    });
    await vi.waitFor(() => expect(usePrivacyStore.getState().pending).not.toBeNull());
    resolveConsent(false);
    await expect(result).rejects.toThrow('No action data was sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/healthz');
  });

  it('blocks hosted source imports without sending their bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ...health, iacImportEnabled: false })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      privacyFetch('arm', '/api/import/arm', { method: 'POST', body: '{}' }),
    ).rejects.toThrow('No source was sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends after consent and remembers only the disclosed action', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal('window', { location: { host: 'app.example.com' } });
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async (url: string) => new Response(JSON.stringify(url === '/healthz' ? health : {})),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = privacyFetch('review', '/api/review', { method: 'POST', body: '{}' });
    await vi.waitFor(() => expect(usePrivacyStore.getState().pending).not.toBeNull());
    resolveConsent(true, true);
    await result;
    await privacyFetch('review', '/api/review', { method: 'POST', body: '{}' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(storage.size).toBe(1);
    expect(usePrivacyStore.getState().lastTransfer).toContain('2 request-body bytes');
  });
});
