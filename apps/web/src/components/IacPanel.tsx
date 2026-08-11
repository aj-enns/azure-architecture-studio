import { useDeferredValue, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileCode2, Info, RefreshCw, X } from 'lucide-react';
import type { IacBundle, IacFile, IacTarget } from '@aar/shared';
import { Button } from '@/components/ui/Button.js';
import { generateIac } from '@/lib/api.js';
import { downloadText } from '@/lib/export.js';
import { cn } from '@/lib/utils.js';
import { useDiagramStore } from '@/store/diagramStore.js';

export function IacPanel({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const diagram = useDiagramStore((state) => state.diagram);
  const deferredDiagram = useDeferredValue(diagram);
  const [target, setTarget] = useState<IacTarget>('bicep');
  const [bundle, setBundle] = useState<IacBundle | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void generateIac(deferredDiagram, target)
      .then((nextBundle) => {
        if (cancelled) return;
        setBundle(nextBundle);
        setSelectedPath((current) =>
          nextBundle.files.some((file) => file.path === current)
            ? current
            : nextBundle.files[0]?.path ?? '',
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'IaC generation failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deferredDiagram, open, target]);

  if (!open) return null;

  const selectedFile = bundle?.files.find((file) => file.path === selectedPath) ?? null;

  return (
    <aside className="flex w-[30rem] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileCode2 size={16} className="text-primary" />
        <span className="text-sm font-semibold">Infrastructure as Code</span>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close IaC panel">
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex h-9 w-full rounded-md border border-border bg-muted p-1" aria-label="IaC target">
            {(['bicep', 'terraform'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTarget(option)}
                className={cn(
                  'h-7 min-w-0 flex-1 rounded text-center text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  target === option ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {loading ? (
              <><RefreshCw size={14} className="animate-spin" /> Generating files...</>
            ) : error ? (
              <><AlertTriangle size={14} className="text-rose-500" /> {error}</>
            ) : (
              <>
                <CheckCircle2 size={14} className="text-emerald-500" />
                {bundle?.generatedResourceCount ?? 0} resources in {bundle?.files.length ?? 0} files
              </>
            )}
          </div>

          {!!bundle?.diagnostics.length && (
            <div className="max-h-28 space-y-1 overflow-y-auto border-l-2 border-amber-500/60 pl-2">
              {bundle.diagnostics.map((diagnostic, index) => (
                <p key={`${diagnostic.nodeId ?? 'diagram'}-${index}`} className="flex gap-1.5 text-[11px] text-muted-foreground">
                  {diagnostic.severity === 'warning' ? (
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
                  ) : (
                    <Info size={12} className="mt-0.5 shrink-0 text-sky-500" />
                  )}
                  {diagnostic.message}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-36 shrink-0 overflow-y-auto border-r border-border bg-muted/30 p-1.5" aria-label="Generated files">
            {bundle?.files.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={cn(
                  'block w-full truncate rounded px-2 py-1.5 text-left font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedPath === file.path ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                {file.path}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center border-b border-border px-2.5">
              <span className="truncate font-mono text-xs">{selectedFile?.path ?? 'No file'}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={!selectedFile}
                onClick={() => selectedFile && downloadFile(selectedFile)}
              >
                <Download size={14} /> Download
              </Button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto bg-background p-3 font-mono text-[11px] leading-5 text-foreground">
              <code>{selectedFile?.content ?? ''}</code>
            </pre>
          </div>
        </div>
      </div>
    </aside>
  );
}

function downloadFile(file: IacFile): void {
  downloadText(file.path.replaceAll('/', '-'), file.content);
}