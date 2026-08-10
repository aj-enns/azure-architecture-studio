import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button.js';
import { fetchHealth, generateDiagram, type DesignMode } from '@/lib/api.js';
import { useDiagramStore } from '@/store/diagramStore.js';

const EXAMPLES = [
  'A three-tier web app: App Service front end, SQL Database, and Redis cache in a resource group.',
  'Event-driven pipeline: Event Hubs into Azure Functions writing to Cosmos DB.',
  'A secure AI chat app using Azure OpenAI, AI Search, Key Vault, and managed identity.',
];

type Mode = 'replace' | 'append';
type HealthState = 'checking' | 'configured' | 'unconfigured' | 'api-unavailable';

/** Guided chat panel: prompt-to-diagram generation (ADR-0010). */
export function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('replace');
  const [design, setDesign] = useState<DesignMode>('bestPractice');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthState, setHealthState] = useState<HealthState>('checking');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const diagram = useDiagramStore((s) => s.diagram);
  const load = useDiagramStore((s) => s.load);
  const mergeDiagram = useDiagramStore((s) => s.mergeDiagram);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setHealthState('checking');
    fetchHealth(controller.signal)
      .then((h) => setHealthState(h.aiConfigured ? 'configured' : 'unconfigured'))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setHealthState('api-unavailable');
        setError('The API is not reachable. Generation is unavailable until the API server is running.');
      });
    textareaRef.current?.focus();
    return () => controller.abort();
  }, [open]);

  if (!open) return null;

  const handleGenerate = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const useContext = mode === 'append' && diagram.nodes.length > 0;
      const result = await generateDiagram(trimmed, useContext ? diagram : undefined, { mode: design });
      if (mode === 'append') mergeDiagram(result);
      else load(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles size={16} className="text-primary" />
        <span className="text-sm font-semibold">Generate with AI</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={onClose}
          aria-label="Close AI panel"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {healthState === 'api-unavailable' && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
            The API is not reachable at <code>/healthz</code>. Start or restart the API server,
            then reopen this panel. If you use F5, make sure the <code>dev: web + api</code>{' '}
            task is still running.
          </div>
        )}

        {healthState === 'unconfigured' && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
            AI generation is not configured. Set <code>AZURE_FOUNDRY_ENDPOINT</code> and{' '}
            <code>AZURE_FOUNDRY_MODEL</code> on the API, then either provide{' '}
            <code>AZURE_FOUNDRY_API_KEY</code> or leave it blank to use Entra ID (for example,{' '}
            <code>az login</code> locally). Restart the API after changing its environment.
          </div>
        )}

        <label className="text-xs font-medium text-muted-foreground" htmlFor="ai-prompt">
          Describe the architecture
        </label>
        <textarea
          id="ai-prompt"
          ref={textareaRef}
          className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="e.g. A web app with a SQL database and a Redis cache…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void handleGenerate();
          }}
          disabled={loading}
        />

        <fieldset className="flex gap-3 text-xs" disabled={loading}>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="ai-mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace canvas
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="ai-mode"
              checked={mode === 'append'}
              onChange={() => setMode('append')}
            />
            Add to canvas
          </label>
        </fieldset>

        <fieldset className="space-y-1 text-xs" disabled={loading}>
          <span className="font-medium text-muted-foreground">Design</span>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="ai-design"
                checked={design === 'bestPractice'}
                onChange={() => setDesign('bestPractice')}
              />
              Best practice
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="ai-design"
                checked={design === 'faithful'}
                onChange={() => setDesign('faithful')}
              />
              Faithful
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Best practice adds a Well-Architected baseline (identity, Key Vault, monitoring, WAF).
            Faithful draws only what you describe.
          </p>
        </fieldset>

        <Button
          onClick={() => void handleGenerate()}
          disabled={loading || !prompt.trim() || healthState !== 'configured'}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {loading ? 'Generating…' : 'Generate'}
        </Button>

        {error && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            role="alert"
            aria-live="assertive"
          >
            <p className="font-semibold">We couldn’t generate the architecture.</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        <div className="mt-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Try an example</p>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="block w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => setPrompt(ex)}
              disabled={loading}
            >
              {ex}
            </button>
          ))}
        </div>

        <p className="mt-auto pt-2 text-[11px] text-muted-foreground">
          Tip: press Ctrl/Cmd+Enter to generate.
        </p>
      </div>
    </aside>
  );
}
