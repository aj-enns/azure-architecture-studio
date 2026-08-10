import { useMemo } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { validateArchitecture, WAF_PILLARS, type WafPillar, type WafSeverity } from '@aar/shared';
import { Button } from '@/components/ui/Button.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { cn } from '@/lib/utils.js';

const PILLAR_LABEL: Record<WafPillar, string> = {
  security: 'Security',
  reliability: 'Reliability',
  performance: 'Performance',
  cost: 'Cost Optimization',
  operational: 'Operational Excellence',
};

const SEVERITY_STYLE: Record<WafSeverity, string> = {
  high: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  low: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
};

function scoreColor(score: number): string {
  if (score >= 90) return 'text-emerald-500';
  if (score >= 70) return 'text-amber-500';
  return 'text-rose-500';
}

/** Deterministic Well-Architected Framework validation panel (no model call). */
export function ValidationPanel({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const diagram = useDiagramStore((s) => s.diagram);
  const select = useDiagramStore((s) => s.select);
  const report = useMemo(() => validateArchitecture(diagram), [diagram]);

  if (!open) return null;

  const byPillar = WAF_PILLARS.map((pillar) => ({
    pillar,
    score: report.scoreByPillar[pillar],
    findings: report.findings.filter((f) => f.pillar === pillar),
  }));

  const selectFirst = (serviceIds?: string[]): void => {
    if (!serviceIds?.length) return;
    const node = diagram.nodes.find((n) => serviceIds.includes(n.serviceId));
    if (node) select({ type: 'node', id: node.id });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ShieldCheck size={16} className="text-primary" />
        <span className="text-sm font-semibold">Well-Architected review</span>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close validation panel">
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between rounded-md border border-border bg-background p-3">
          <div>
            <div className="text-xs text-muted-foreground">Overall score</div>
            <div className="text-xs text-muted-foreground">
              {report.findings.length} finding{report.findings.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className={cn('text-3xl font-bold tabular-nums', scoreColor(report.overallScore))}>
            {report.overallScore}
          </div>
        </div>

        {diagram.nodes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add or generate some services, then reopen this panel to review the design against the five
            Well-Architected Framework pillars.
          </p>
        )}

        {byPillar.map(({ pillar, score, findings }) => (
          <div key={pillar} className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
              <span className="text-xs font-semibold">{PILLAR_LABEL[pillar]}</span>
              <span className={cn('text-xs font-semibold tabular-nums', scoreColor(score))}>{score}</span>
            </div>
            {findings.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">No issues detected.</p>
            ) : (
              <ul className="divide-y divide-border">
                {findings.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => selectFirst(f.serviceIds)}
                      className="w-full px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase', SEVERITY_STYLE[f.severity])}>
                          {f.severity}
                        </span>
                        <span className="truncate text-xs font-medium">{f.title}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{f.message}</p>
                      <p className="mt-1 text-xs text-foreground/80">
                        <span className="font-medium">Fix:</span> {f.fix}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
