import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, RotateCcw, Send, Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { Diagram } from '@aar/shared';
import { Button } from '@/components/ui/Button.js';
import { askArchitecture, type AdvisorMessage } from '@/lib/api.js';

type HealthState = 'checking' | 'configured' | 'unconfigured' | 'api-unavailable';

interface ChatTurn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations?: { title: string; url: string; excerpt: string }[];
  diagramPrompt?: string | null;
  groundingError?: string;
  failedQuestion?: string;
  userTurnId?: number;
}

const STARTERS = [
  'Do I need a load balancer?',
  'What is the biggest single point of failure?',
  'What should I improve first?',
];

const MD: Components = {
  p: ({ children }) => (
    <p className="mt-2 text-xs leading-relaxed text-foreground/90 first:mt-0">{children}</p>
  ),
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">{children}</ol>,
  li: ({ children }) => <li className="text-foreground/90">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{children}</code>
  ),
};

function toHistory(turns: ChatTurn[]): AdvisorMessage[] {
  return turns
    .filter((turn) => !turn.failedQuestion)
    .map((turn) => ({ role: turn.role, content: turn.content }))
    .slice(-10);
}

export function AdvisorChat({
  active,
  healthState,
  diagram,
  model,
  onBuild,
}: {
  active: boolean;
  healthState: HealthState;
  diagram: Diagram;
  model?: string;
  onBuild: (prompt: string) => void;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const nextId = useRef(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) textareaRef.current?.focus();
  }, [active]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, loading]);

  const submit = async (question: string, baseTurns = turns): Promise<void> => {
    const trimmed = question.trim();
    if (!trimmed || loading || healthState !== 'configured') return;

    const userTurn: ChatTurn = { id: nextId.current++, role: 'user', content: trimmed };
    setTurns([...baseTurns, userTurn]);
    setInput('');
    setLoading(true);
    try {
      const result = await askArchitecture(
        trimmed,
        diagram,
        toHistory(baseTurns),
        model ? { model } : undefined,
      );
      setTurns((current) => [
        ...current,
        {
          id: nextId.current++,
          role: 'assistant',
          content: result.markdown,
          citations: result.citations,
          diagramPrompt: result.diagramPrompt,
          groundingError: result.groundingError,
        },
      ]);
    } catch (error) {
      setTurns((current) => [
        ...current,
        {
          id: nextId.current++,
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Architecture advice failed.',
          failedQuestion: trimmed,
          userTurnId: userTurn.id,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const retry = (failedTurn: ChatTurn): void => {
    const baseTurns = turns.filter(
      (turn) => turn.id !== failedTurn.id && turn.id !== failedTurn.userTurnId,
    );
    setTurns(baseTurns);
    void submit(failedTurn.failedQuestion ?? '', baseTurns);
  };

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ask about the current architecture. Answers use the latest diagram and can suggest a
              change, but never alter the canvas automatically.
            </p>
            <div className="space-y-1.5">
              {STARTERS.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="block w-full rounded-md border border-border bg-background px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={() => setInput(question)}
                  disabled={loading}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            className={
              turn.role === 'user'
                ? 'ml-8 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground'
                : 'mr-3 rounded-md border border-border bg-background p-3'
            }
          >
            {turn.role === 'user' ? (
              turn.content
            ) : turn.failedQuestion ? (
              <div className="space-y-2 text-xs leading-relaxed text-foreground" role="alert">
                <p>{turn.content}</p>
                <Button variant="outline" size="sm" onClick={() => retry(turn)} disabled={loading}>
                  <RotateCcw size={14} /> Retry
                </Button>
              </div>
            ) : (
              <>
                <Markdown remarkPlugins={[remarkGfm]} components={MD}>
                  {turn.content}
                </Markdown>
                {turn.groundingError && (
                  <p className="mt-2 border-t border-border pt-2 text-[11px] text-amber-600 dark:text-amber-400">
                    {turn.groundingError}
                  </p>
                )}
                {turn.citations && turn.citations.length > 0 && (
                  <div className="mt-3 border-t border-border pt-2">
                    <p className="text-[11px] font-semibold text-muted-foreground">Sources</p>
                    <ul className="mt-1 space-y-1">
                      {turn.citations.map((citation) => (
                        <li key={citation.url} className="text-[11px]">
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            {citation.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {turn.diagramPrompt && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => onBuild(turn.diagramPrompt!)}
                  >
                    Modify diagram <ArrowRight size={14} />
                  </Button>
                )}
              </>
            )}
          </div>
        ))}

        {loading && (
          <div className="mr-3 flex items-center gap-2 rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Thinking about the current diagram...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            aria-label="Ask about the architecture"
            className="max-h-36 min-h-20 flex-1 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Ask about reliability, security, cost, or service choices..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit(input);
              }
            }}
            disabled={loading || healthState !== 'configured'}
          />
          <Button
            size="icon"
            onClick={() => void submit(input)}
            disabled={loading || !input.trim() || healthState !== 'configured'}
            aria-label="Send architecture question"
            title="Send (Enter)"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
        {turns.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setTurns([])}
            disabled={loading}
          >
            <Trash2 size={14} /> Clear conversation
          </Button>
        )}
      </div>
    </div>
  );
}
