import { create } from 'zustand';

export interface PrivacyHealth {
  status: string;
  aiConfigured: boolean;
  iacImportEnabled: boolean;
  privacy: {
    mode: 'hosted' | 'self-hosted';
    aiHost: string | null;
    learnHost: string | null;
  };
}

export type PrivacyAction =
  'generate' | 'image' | 'advise' | 'review' | 'resiliency' | 'github' | 'arm' | 'azure' | 'iac';

export interface Disclosure {
  action: PrivacyAction;
  title: string;
  data: string;
  destinations: string[];
  onward: string[];
  mode: string;
}

const actions: Record<PrivacyAction, { title: string; data: string }> = {
  generate: {
    title: 'Generate diagram',
    data: 'Your prompt and the current diagram, including names, labels and properties.',
  },
  image: {
    title: 'Import diagram image',
    data: 'The entire selected image and your accompanying prompt. Images can contain confidential information.',
  },
  advise: {
    title: 'Ask AI advisor',
    data: 'Your message, up to 10 prior chat messages and the current diagram, including names, labels and properties.',
  },
  review: {
    title: 'AI architecture review',
    data: 'The current diagram, including names, labels and properties. The server adds analysis results to the model request.',
  },
  resiliency: {
    title: 'Refresh resiliency',
    data: 'The current diagram, including names, labels and properties.',
  },
  github: {
    title: 'Import GitHub repository',
    data: 'The repository URL. This app server retrieves matching IaC file contents from GitHub; no local files are sent.',
  },
  arm: {
    title: 'Import ARM template',
    data: 'The full selected template and its filename. This is source content, not just a diagram.',
  },
  azure: {
    title: 'Import Azure resource group',
    data: 'The subscription ID and resource group name. The server uses its Azure identity to retrieve resource metadata; your browser does not send Azure credentials.',
  },
  iac: {
    title: 'Generate IaC',
    data: 'The current diagram and selected output format. Processing stays in this deployment; the diagram still leaves your computer.',
  },
};

export function describeAction(
  action: PrivacyAction,
  health: PrivacyHealth,
  appHost: string,
  grounded = true,
): Disclosure {
  const onward: string[] = [];
  const ai =
    ['generate', 'image', 'advise', 'review'].includes(action) ||
    (action === 'resiliency' && grounded);
  if (ai && health.privacy.aiHost) onward.push(health.privacy.aiHost);
  if (ai && grounded && action !== 'image' && health.privacy.learnHost)
    onward.push(health.privacy.learnHost);
  if (action === 'github') onward.push('api.github.com', 'raw.githubusercontent.com');
  if (action === 'azure') onward.push('management.azure.com', 'login.microsoftonline.com');
  const learnDisclosure = onward.includes(health.privacy.learnHost ?? '')
    ? ' Grounding sends derived search queries to Microsoft Learn, potentially including prompt text or architecture names.'
    : '';
  return {
    action,
    ...actions[action],
    data: actions[action].data + learnDisclosure,
    destinations: [appHost, ...onward],
    onward,
    mode: health.privacy.mode,
  };
}

export function consentKey(disclosure: Disclosure): string {
  return `aas-consent-v1:${JSON.stringify(disclosure)}`;
}

interface PendingConsent {
  disclosure: Disclosure;
  bytes: number;
  resolve: (allowed: boolean) => void;
}

interface PrivacyState {
  health: PrivacyHealth | null;
  pending: PendingConsent | null;
  lastTransfer: string | null;
}

export const usePrivacyStore = create<PrivacyState>(() => ({
  health: null,
  pending: null,
  lastTransfer: null,
}));

export function resetConsent(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('aas-consent-v1:')) localStorage.removeItem(key);
    }
  } catch {
    usePrivacyStore.setState({
      lastTransfer: 'Browser storage is unavailable; consent is not remembered.',
    });
  }
}

export function resolveConsent(allowed: boolean, remember = false): void {
  const pending = usePrivacyStore.getState().pending;
  if (!pending) return;
  if (allowed && remember) {
    try {
      localStorage.setItem(consentKey(pending.disclosure), 'yes');
    } catch {
      usePrivacyStore.setState({
        lastTransfer: 'Browser storage unavailable; permission applies only to this request.',
      });
    }
  }
  usePrivacyStore.setState({ pending: null });
  pending.resolve(allowed);
}

export async function refreshPrivacy(signal?: AbortSignal | null): Promise<PrivacyHealth> {
  const response = await fetch('/healthz', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Cannot verify data destinations. No action data was sent.');
  const health = (await response.json()) as PrivacyHealth;
  if (
    !health.privacy ||
    !['hosted', 'self-hosted'].includes(health.privacy.mode) ||
    typeof health.iacImportEnabled !== 'boolean' ||
    !(health.privacy.aiHost === null || typeof health.privacy.aiHost === 'string') ||
    !(health.privacy.learnHost === null || typeof health.privacy.learnHost === 'string')
  ) {
    throw new Error('This server does not provide data-sharing details. No action data was sent.');
  }
  usePrivacyStore.setState({ health });
  return health;
}

export async function privacyFetch(
  action: PrivacyAction,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const health = await refreshPrivacy(init.signal);
  if (['arm', 'github'].includes(action) && !health.iacImportEnabled) {
    throw new Error('IaC import is only available in self-hosted mode. No source was sent.');
  }
  const payload = JSON.parse(String(init.body ?? '{}')) as { grounded?: boolean };
  const disclosure = describeAction(action, health, window.location.host, payload.grounded ?? true);
  const bytes = new TextEncoder().encode(String(init.body ?? '')).byteLength;
  let remembered = false;
  try {
    remembered = localStorage.getItem(consentKey(disclosure)) === 'yes';
  } catch {
    remembered = false;
  }
  if ((disclosure.onward.length > 0 || action === 'arm') && !remembered) {
    if (usePrivacyStore.getState().pending)
      throw new Error('Finish the current data-sharing confirmation first.');
    init.signal?.throwIfAborted();
    const allowed = await new Promise<boolean>((resolve) => {
      const abort = () => resolveConsent(false);
      usePrivacyStore.setState({
        pending: {
          disclosure,
          bytes,
          resolve: (value) => {
            init.signal?.removeEventListener('abort', abort);
            resolve(value);
          },
        },
      });
      init.signal?.addEventListener('abort', abort, { once: true });
    });
    if (!allowed) throw new Error('Cancelled. No action data was sent.');
  }
  init.signal?.throwIfAborted();
  usePrivacyStore.setState({
    lastTransfer: `${disclosure.title}: sending ${bytes.toLocaleString()} request-body bytes to ${window.location.host}.`,
  });
  try {
    const response = await fetch(url, init);
    usePrivacyStore.setState({
      lastTransfer: `${disclosure.title}: sent ${bytes.toLocaleString()} request-body bytes to ${window.location.host}. ${disclosure.onward.length ? `Configured onward destinations: ${disclosure.onward.join(', ')}.` : 'Processing stays in this deployment.'} ${response.ok ? 'Completed.' : 'Server returned an error.'}`,
    });
    return response;
  } catch (error) {
    usePrivacyStore.setState({
      lastTransfer: `${disclosure.title}: connection failed; data may already have reached ${window.location.host}.`,
    });
    throw error;
  }
}
