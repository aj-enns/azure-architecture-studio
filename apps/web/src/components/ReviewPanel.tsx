import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Loader2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { Button } from '@/components/ui/Button.js';
import { fetchHealth, reviewDiagram, type ArchitectureReviewResult } from '@/lib/api.js';
import { useDiagramStore } from '@/store/diagramStore.js';

type HealthState = 'checking' | 'configured' | 'unconfigured' | 'api-unavailable';

/** Compact styling for the rendered review, since no typography plugin is used. */
const MD: Components = {
  h2: ({ children }) => <h2 className="mt-4 border-b border-border pb-1 text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 text-xs font-semibold">{children}</h3>,
  p: ({ children }) => <p className="mt-2 text-xs leading-relaxed text-foreground/90">{children}</p>,
  ul: ({ children }) => <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">{children}</ul>,
  ol: ({ children }) => <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs">{children}</ol>,
  li: ({ children }) => <li className="text-foreground/90">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-1.5 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-1.5 py-1 align-top">{children}</td>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{children}</code>,
  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
};

/** AI architecture review panel (the waf-architecture-review methodology). */
export function ReviewPanel({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const diagram = useDiagramStore((s) => s.diagram);
  const [grounded, setGrounded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArchitectureReviewResult | null>(null);
  const [healthState, setHealthState] = useState<HealthState>('checking');
  const runId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setHealthState('checking');
    fetchHealth(controller.signal)
      .then((h) => setHealthState(h.aiConfigured ? 'configured' : 'unconfigured'))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setHealthState('api-unavailable');
      });
    return () => controller.abort();
  }, [open]);

  if (!open) return null;

  const runReview = async (): Promise<void> => {
    if (loading) return;
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    try {
      const review = await reviewDiagram(diagram, { grounded });
      if (id === runId.current) setResult(review);
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : 'Review failed.');
    } finally {
      if (id === runId.current) setLoading(false);
    }
  };

  const empty = diagram.nodes.length === 0;

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ClipboardCheck size={16} className="text-primary" />
        <span className="text-sm font-semibold">Architecture review</span>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close review panel">
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {healthState === 'api-unavailable' && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
            The API is not reachable at <code>/healthz</code>. Start or restart the API server, then reopen this
            panel.
          </div>
        )}

        {healthState === 'unconfigured' && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
            AI review is not configured. Set <code>AZURE_FOUNDRY_ENDPOINT</code> and{' '}
            <code>AZURE_FOUNDRY_MODEL</code> on the API, then provide <code>AZURE_FOUNDRY_API_KEY</code> or leave
            it blank to use Entra ID. Restart the API after changing its environment.
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A senior-architect review across the five Well-Architected pillars with a resiliency and DR deep dive,
          grounded in the built-in WAF, SLA, and cost analysis.
        </p>

        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={grounded} onChange={(e) => setGrounded(e.target.checked)} disabled={loading} />
          Ground with Microsoft Learn
        </label>

        <Button
          onClick={() => void runReview()}
          disabled={loading || empty || healthState !== 'configured'}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
          {loading ? 'Reviewing…' : result ? 'Re-run review' : 'Run review'}
        </Button>

        {empty && (
          <p className="text-xs text-muted-foreground">Add or generate some services first, then run the review.</p>
        )}

        {error && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            role="alert"
            aria-live="assertive"
          >
            <p className="font-semibold">We couldn’t complete the review.</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        {result?.groundingError && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
            {result.groundingError}
          </div>
        )}

        {result && (
          <div className="rounded-md border border-border bg-background p-3">
            <Markdown remarkPlugins={[remarkGfm]} components={MD}>
              {result.markdown}
            </Markdown>
          </div>
        )}
      </div>
    </aside>
  );
}
