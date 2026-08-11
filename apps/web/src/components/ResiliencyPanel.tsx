import { useMemo, useState } from 'react';
import { Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import {
  analyzeResiliency,
  AZ_REGIONS_VERIFIED_ON,
  getServiceDefinition,
  SLA_BASELINE_VERIFIED_ON,
  slaToDowntimeMinutes,
  type ResilienceTier,
  type ResiliencyFinding,
  type ResiliencySeverity,
  type SlaProfile,
} from '@aar/shared';
import { Button } from '@/components/ui/Button.js';
import { analyzeDiagramResiliency, type ResiliencyResult } from '@/lib/api.js';
import { downloadCsv } from '@/lib/export.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { cn } from '@/lib/utils.js';

const SEVERITY_STYLE: Record<ResiliencySeverity, string> = {
  high: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  low: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
};

const TIER_LABEL: Record<ResilienceTier, string> = {
  global: 'Global',
  nonzonal: 'Single zone',
  zoneRedundant: 'Zone redundant',
  multiRegion: 'Multi-region',
};

const DEFAULT_TARGET = { slaPercent: 99.9, rtoMinutes: 240, rpoMinutes: 60 };

function slaColor(slaPercent: number): string {
  if (slaPercent >= 99.99) return 'text-emerald-500';
  if (slaPercent >= 99.9) return 'text-amber-500';
  return 'text-rose-500';
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return 'not published';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

/** Composite SLA, RPO/RTO, and weakest-link review for the current design. */
export function ResiliencyPanel({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const diagram = useDiagramStore((s) => s.diagram);
  const select = useDiagramStore((s) => s.select);
  const setResiliencyTarget = useDiagramStore((s) => s.setResiliencyTarget);
  const [grounded, setGrounded] = useState<ResiliencyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overrides = useMemo<SlaProfile[] | undefined>(() => grounded?.profiles, [grounded]);
  const report = useMemo(() => analyzeResiliency(diagram, { overrides }), [diagram, overrides]);

  if (!open) return null;

  const target = diagram.metadata.resiliency;

  const patchTarget = (patch: Partial<typeof DEFAULT_TARGET>): void => {
    setResiliencyTarget({ ...(target ?? DEFAULT_TARGET), ...patch });
  };

  const refreshFromLearn = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeDiagramResiliency(diagram, { grounded: true });
      setGrounded(result);
      if (result.groundingError) setError(result.groundingError);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the API.');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = (): void => {
    const rows = [
      ['Resource', 'Service', 'Tier', 'SLA %', 'RTO', 'RPO', 'On critical path', 'Source', 'Basis'],
      ...report.nodes.map((n) => [
        n.label,
        getServiceDefinition(n.serviceId)?.name ?? n.serviceId,
        TIER_LABEL[n.profile.tier],
        String(n.profile.slaPercent),
        formatMinutes(n.profile.rtoMinutes),
        formatMinutes(n.profile.rpoMinutes),
        n.onCriticalPath ? 'yes' : 'no',
        n.profile.source.kind,
        n.profile.basis,
      ]),
      [
        'COMPOSITE',
        '',
        '',
        String(report.compositeSlaPercent),
        formatMinutes(report.worstRtoMinutes),
        formatMinutes(report.worstRpoMinutes),
        '',
        '',
        `${report.downtimePerMonthMinutes} min/month downtime`,
      ],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadCsv(`${diagram.metadata.name}-resiliency`, csv);
  };

  const selectNode = (nodeIds?: string[]): void => {
    const id = nodeIds?.[0];
    if (id) select({ type: 'node', id });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ShieldAlert size={16} className="text-primary" />
        <span className="text-sm font-semibold">Resiliency</span>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close resiliency panel">
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Composite SLA</div>
              <div className="text-xs text-muted-foreground">
                {report.downtimePerMonthMinutes} min downtime/month
              </div>
            </div>
            <div className={cn('text-3xl font-bold tabular-nums', slaColor(report.compositeSlaPercent))}>
              {report.compositeSlaPercent}%
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2 text-xs">
            <div>
              <div className="text-muted-foreground">Worst RTO</div>
              <div className="font-medium tabular-nums">{formatMinutes(report.worstRtoMinutes)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Worst RPO</div>
              <div className="font-medium tabular-nums">{formatMinutes(report.worstRpoMinutes)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
            <span className="text-xs font-semibold">Target</span>
            {target && (
              <span
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase',
                  report.meetsTarget
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : SEVERITY_STYLE.high,
                )}
              >
                {report.meetsTarget ? 'Met' : 'Missed'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 p-2.5">
            <label className="text-[11px] text-muted-foreground">
              SLA %
              <input
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={target?.slaPercent ?? DEFAULT_TARGET.slaPercent}
                onChange={(e) => patchTarget({ slaPercent: Number(e.target.value) })}
                className="mt-0.5 w-full rounded border border-input bg-background px-1.5 py-1 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              RTO min
              <input
                type="number"
                min="0"
                value={target?.rtoMinutes ?? DEFAULT_TARGET.rtoMinutes}
                onChange={(e) => patchTarget({ rtoMinutes: Number(e.target.value) })}
                className="mt-0.5 w-full rounded border border-input bg-background px-1.5 py-1 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              RPO min
              <input
                type="number"
                min="0"
                value={target?.rpoMinutes ?? DEFAULT_TARGET.rpoMinutes}
                onChange={(e) => patchTarget({ rpoMinutes: Number(e.target.value) })}
                className="mt-0.5 w-full rounded border border-input bg-background px-1.5 py-1 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          {target && (
            <button
              type="button"
              onClick={() => setResiliencyTarget(undefined)}
              className="w-full border-t border-border px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
            >
              Clear target
            </button>
          )}
        </div>

        {diagram.nodes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add or generate some services, then reopen this panel to see the composite availability of the
            design and which component limits it.
          </p>
        )}

        {report.weakestLink && (
          <button
            type="button"
            onClick={() => selectNode([report.weakestLink!.nodeId])}
            className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-left hover:bg-rose-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="text-[10px] font-medium uppercase text-rose-600 dark:text-rose-400">Weakest link</div>
            <div className="mt-0.5 truncate text-xs font-medium">{report.weakestLink.label}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {report.weakestLink.profile.slaPercent}% — {report.weakestLink.profile.basis}
            </p>
          </button>
        )}

        {report.nodes.length > 0 && (
          <div className="rounded-md border border-border">
            <div className="border-b border-border px-2.5 py-1.5 text-xs font-semibold">
              By resource, worst first
            </div>
            <ul className="divide-y divide-border">
              {report.nodes.map((n) => (
                <li key={n.nodeId}>
                  <button
                    type="button"
                    onClick={() => selectNode([n.nodeId])}
                    className="w-full px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium">{n.label}</span>
                      <span
                        className={cn('ml-auto text-xs font-semibold tabular-nums', slaColor(n.profile.slaPercent))}
                      >
                        {n.profile.slaPercent}%
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                        {TIER_LABEL[n.profile.tier]}
                      </span>
                      {!n.onCriticalPath && (
                        <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                          not on request path
                        </span>
                      )}
                      {n.profile.source.kind === 'learn' && (
                        <span className="rounded border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-sky-600 dark:text-sky-400">
                          from Learn
                        </span>
                      )}
                    </div>
                    {n.blocked && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{n.blocked.message}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.findings.length > 0 && (
          <div className="rounded-md border border-border">
            <div className="border-b border-border px-2.5 py-1.5 text-xs font-semibold">Findings</div>
            <ul className="divide-y divide-border">
              {report.findings.map((f: ResiliencyFinding) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => selectNode(f.nodeIds)}
                    className="w-full px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase',
                          SEVERITY_STYLE[f.severity],
                        )}
                      >
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
          </div>
        )}

        {diagram.nodes.length > 0 && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refreshFromLearn()} disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {loading ? 'Checking…' : 'Refresh from Learn'}
            </Button>
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        )}

        {error && (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"
            role="status"
          >
            {error} Showing baseline figures instead.
          </div>
        )}

        {grounded?.citations && grounded.citations.length > 0 && (
          <div className="rounded-md border border-border">
            <div className="border-b border-border px-2.5 py-1.5 text-xs font-semibold">Microsoft Learn sources</div>
            <ul className="divide-y divide-border">
              {grounded.citations.map((c) => (
                <li key={c.url || c.title} className="px-2.5 py-1.5">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                      {c.title}
                    </a>
                  ) : (
                    <span className="text-xs">{c.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-auto pt-2 text-[11px] text-muted-foreground">
          Representative planning figures, not a contractual SLA — published coverage is narrower than a
          service as a whole. Baseline checked {SLA_BASELINE_VERIFIED_ON}; availability-zone regions checked{' '}
          {AZ_REGIONS_VERIFIED_ON}. A {report.compositeSlaPercent}% composite allows{' '}
          {slaToDowntimeMinutes(report.compositeSlaPercent)} minutes of downtime a month.
        </p>
      </div>
    </aside>
  );
}
