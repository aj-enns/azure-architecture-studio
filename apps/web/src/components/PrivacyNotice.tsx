import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { Button } from './ui/Button.js';
import {
  describeAction,
  refreshPrivacy,
  resetConsent,
  resolveConsent,
  usePrivacyStore,
  type PrivacyAction,
} from '@/lib/privacy.js';

export function PrivacyNotice({
  action,
  grounded = true,
}: {
  action: PrivacyAction | 'local';
  grounded?: boolean;
}): JSX.Element {
  const health = usePrivacyStore((state) => state.health);
  if (action === 'local')
    return (
      <p className="my-2 text-xs text-muted-foreground">
        Local processing: no action data leaves this browser.
      </p>
    );
  if (!health)
    return (
      <p className="my-2 text-xs text-muted-foreground">
        Data destinations are unavailable. Network actions wait for verification.
      </p>
    );
  const disclosure = describeAction(action, health, window.location.host, grounded);
  return (
    <details className="my-2 min-w-0 text-xs text-muted-foreground">
      <summary className="cursor-pointer break-words">
        Data sharing:{' '}
        {disclosure.onward.length ? 'app server and external services' : 'stays in this deployment'}
      </summary>
      <p className="mt-2">{disclosure.data}</p>
      <p className="mt-1 break-all">Computer to app server: {disclosure.destinations[0]}</p>
      {disclosure.onward.length > 0 && (
        <p className="mt-1 break-all">Server onward: {disclosure.onward.join(', ')}</p>
      )}
      {grounded &&
        health.privacy.learnHost &&
        ['generate', 'advise', 'review', 'resiliency'].includes(action) && (
          <p className="mt-1">
            Grounding sends derived search queries to Microsoft Learn; queries may include prompt
            text or architecture names.
          </p>
        )}
    </details>
  );
}

export function PrivacyCenter(): JSX.Element {
  const health = usePrivacyStore((state) => state.health);
  const pending = usePrivacyStore((state) => state.pending);
  const lastTransfer = usePrivacyStore((state) => state.lastTransfer);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void refreshPrivacy(controller.signal).catch((caught: unknown) => {
      if (!controller.signal.aborted)
        setError(caught instanceof Error ? caught.message : 'Privacy metadata unavailable.');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setRemember(false);
    if (pending) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [pending]);

  return (
    <>
      <details className="max-h-48 shrink-0 overflow-auto border-t border-border bg-card px-3 py-2 text-xs">
        <summary className="cursor-pointer break-words">
          <ShieldCheck size={13} className="mr-1 inline" />
          {health
            ? `${health.privacy.mode === 'hosted' ? 'Hosted demo' : 'Self-hosted configuration'} | AI: ${health.privacy.aiHost ?? 'not configured'}`
            : 'Data sharing: checking configuration'}
          <span className="ml-2 text-muted-foreground">Data-sharing details</span>
        </summary>
        <p className="mt-2">
          Self-hosted is a configuration label, not a verified security boundary. Chat, diagrams and
          images can contain confidential information.
        </p>
        <p className="mt-1 break-all">
          App server: {window.location.host}.{' '}
          {health?.privacy.learnHost
            ? `Learn grounding: ${health.privacy.learnHost}.`
            : 'Learn grounding is disabled or unknown.'}
        </p>
        <p className="mt-1">
          Drawing, JSON import/export, local validation and cost estimates run in your browser.
          Folder parsing is local; later AI actions can send the derived diagram.
        </p>
        {error && !health && (
          <p role="alert" className="mt-1 text-destructive">
            {error}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              resetConsent();
              usePrivacyStore.setState({
                lastTransfer: 'Remembered data-sharing choices cleared.',
              });
            }}
          >
            <RotateCcw size={14} /> Reset permissions
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void refreshPrivacy()
                .then(() => setError(null))
                .catch((caught: unknown) => setError(String(caught)))
            }
          >
            Refresh destinations
          </Button>
        </div>
      </details>
      {lastTransfer && (
        <p
          role="status"
          className="max-h-16 shrink-0 overflow-auto break-words border-t border-border px-3 py-1 text-xs text-muted-foreground"
        >
          {lastTransfer}
        </p>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby="privacy-consent-title"
        onCancel={(event) => {
          event.preventDefault();
          resolveConsent(false);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className="m-auto max-h-[85vh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl backdrop:bg-black/60"
      >
        {pending && (
          <>
            <h2 id="privacy-consent-title" className="text-base font-semibold">
              What leaves your computer
            </h2>
            <p className="mt-3 font-medium">{pending.disclosure.title}</p>
            <p className="mt-2 text-sm">{pending.disclosure.data}</p>
            <p className="mt-2 break-all text-sm">
              Computer to app server: {pending.disclosure.destinations[0]}
            </p>
            {pending.disclosure.onward.length > 0 && (
              <p className="mt-2 break-all text-sm">
                Server onward: {pending.disclosure.onward.join(', ')}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {pending.bytes.toLocaleString()} bytes in this request body, excluding network
              headers. Onward payloads can differ. Only share information approved for these
              destinations.
            </p>
            {pending.disclosure.onward.includes(health?.privacy.learnHost ?? '') && (
              <p className="mt-2 text-xs text-muted-foreground">
                Microsoft Learn receives derived search queries that may include prompt text or
                architecture names.
              </p>
            )}
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember this action and these destinations on this browser
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => resolveConsent(false)}>
                <X size={16} /> Cancel
              </Button>
              <Button onClick={() => resolveConsent(true, remember)}>
                <Check size={16} /> Allow and continue
              </Button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
