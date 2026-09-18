import { useMemo } from 'react';
import { DollarSign, Download, Gauge, X } from 'lucide-react';
import {
  analyzeThroughput,
  estimateDiagramCost,
  getServiceDefinition,
  type ServiceCategory,
} from '@aas/shared';
import { Button } from '@/components/ui/Button.js';
import { PrivacyNotice } from './PrivacyNotice.js';
import { downloadCsv } from '@/lib/export.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { cn } from '@/lib/utils.js';

const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  compute: 'Compute',
  containers: 'Containers',
  web: 'Web',
  databases: 'Databases',
  storage: 'Storage',
  networking: 'Networking',
  ai: 'AI',
  analytics: 'Analytics',
  integration: 'Integration',
  security: 'Security',
  identity: 'Identity',
  devops: 'DevOps',
  management: 'Management',
};

const DEFAULT_THROUGHPUT_TARGET = { usersPerMinute: 1000, requestsPerUser: 3 };

function usd(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function rpm(n: number): string {
  return n.toLocaleString('en-US');
}

/** Deterministic monthly cost estimate panel (curated representative pricing). */
export function CostPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const diagram = useDiagramStore((s) => s.diagram);
  const select = useDiagramStore((s) => s.select);
  const setThroughputTarget = useDiagramStore((s) => s.setThroughputTarget);
  const cost = useMemo(() => estimateDiagramCost(diagram), [diagram]);
  const throughput = useMemo(() => analyzeThroughput(diagram), [diagram]);

  if (!open) return null;

  const target = diagram.metadata.throughput;
  const tpByNode = new Map(throughput.nodes.map((n) => [n.nodeId, n]));
  const projectedTotal = cost.totalMonthlyUsd + throughput.totalAddedMonthlyUsd;

  const patchTarget = (patch: Partial<typeof DEFAULT_THROUGHPUT_TARGET>): void => {
    setThroughputTarget({ ...(target ?? DEFAULT_THROUGHPUT_TARGET), ...patch });
  };

  const exportCsv = (): void => {
    const rows = [
      [
        'Service',
        'Type',
        'Category',
        'Region',
        'Monthly USD',
        'Usage-based',
        'Capacity/min',
        'Meets target',
        'Recommended scale',
        'Added USD',
      ],
      ...cost.nodes.map((n) => {
        const tp = tpByNode.get(n.id);
        return [
          n.label,
          getServiceDefinition(n.serviceId)?.name ?? n.serviceId,
          getServiceDefinition(n.serviceId)?.category ?? '',
          cost.region,
          String(n.monthlyUsd),
          n.usageBased ? 'yes' : 'no',
          tp ? String(tp.requestsPerMinute) : '',
          tp ? (tp.meetsTarget ? 'yes' : 'no') : '',
          tp && tp.addedUnits > 0
            ? `${tp.scaleProperty} ${tp.currentUnits}->${tp.recommendedUnits}`
            : '',
          tp ? String(tp.addedMonthlyUsd) : '',
        ];
      }),
      [
        'TOTAL',
        '',
        '',
        cost.region,
        String(cost.totalMonthlyUsd),
        '',
        throughput.capacityPerMinute === null ? '' : String(throughput.capacityPerMinute),
        throughput.meetsTarget ? 'yes' : 'no',
        '',
        String(throughput.totalAddedMonthlyUsd),
      ],
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    downloadCsv(`${diagram.metadata.name}-costs`, csv);
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <DollarSign size={16} className="text-primary" />
        <span className="text-sm font-semibold">Monthly cost estimate</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={onClose}
          aria-label="Close cost panel"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <PrivacyNotice action="local" />
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Total ({cost.region})</span>
            <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {cost.hasUsageBased ? '~' : ''}
              {usd(cost.totalMonthlyUsd)}
              {cost.hasExternalNodes ? '*' : ''}
              <span className="ml-1 text-xs font-normal text-muted-foreground">/mo</span>
            </span>
          </div>
          {target && throughput.totalAddedMonthlyUsd > 0 && (
            <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-xs">
              <span className="text-muted-foreground">Projected to meet target</span>
              <span className="tabular-nums font-medium text-amber-600 dark:text-amber-400">
                {usd(projectedTotal)}/mo
                <span className="ml-1 font-normal text-muted-foreground">
                  (+{usd(throughput.totalAddedMonthlyUsd)})
                </span>
              </span>
            </div>
          )}
        </div>

        {diagram.nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add or generate services to estimate monthly cost.
          </p>
        ) : (
          <>
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Gauge size={13} className="text-primary" /> Throughput
                </span>
                {target && (
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase',
                      throughput.meetsTarget
                        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {throughput.meetsTarget ? 'Met' : 'Missed'}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 p-2.5">
                <label className="text-[11px] text-muted-foreground">
                  Users / min
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={target?.usersPerMinute ?? DEFAULT_THROUGHPUT_TARGET.usersPerMinute}
                    onChange={(e) =>
                      patchTarget({ usersPerMinute: Math.max(0, Number(e.target.value)) })
                    }
                    className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs tabular-nums text-foreground"
                  />
                </label>
                <label className="text-[11px] text-muted-foreground">
                  Requests / user
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={target?.requestsPerUser ?? DEFAULT_THROUGHPUT_TARGET.requestsPerUser}
                    onChange={(e) =>
                      patchTarget({ requestsPerUser: Math.max(1, Number(e.target.value)) })
                    }
                    className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs tabular-nums text-foreground"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-border px-2.5 py-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Current throughput</div>
                  <div className="font-medium tabular-nums">
                    {throughput.capacityPerMinute === null
                      ? '—'
                      : `${rpm(throughput.capacityPerMinute)}/min`}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Target throughput</div>
                  <div className="font-medium tabular-nums">
                    {throughput.targetPerMinute === null
                      ? '—'
                      : `${rpm(throughput.targetPerMinute)}/min`}
                  </div>
                </div>
              </div>
              {throughput.bottleneck && (
                <button
                  type="button"
                  onClick={() => select({ type: 'node', id: throughput.bottleneck!.nodeId })}
                  className="flex w-full items-center justify-between gap-2 border-t border-border px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <span className="text-muted-foreground">Bottleneck</span>
                  <span className="truncate font-medium">{throughput.bottleneck.label}</span>
                </button>
              )}
              {target && throughput.capacityPerMinute === null && (
                <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  No request-serving resources to size (compute, gateway, or data tier).
                </p>
              )}
            </div>

            <div className="rounded-md border border-border">
              <div className="border-b border-border px-2.5 py-1.5 text-xs font-semibold">
                By category
              </div>
              <ul className="divide-y divide-border">
                {cost.byCategory.map(({ category, monthlyUsd }) => (
                  <li
                    key={category}
                    className="flex items-center justify-between px-2.5 py-1.5 text-xs"
                  >
                    <span>{CATEGORY_LABEL[category]}</span>
                    <span className="tabular-nums text-muted-foreground">{usd(monthlyUsd)}/mo</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border border-border">
              <div className="border-b border-border px-2.5 py-1.5 text-xs font-semibold">
                By service
              </div>
              <ul className="divide-y divide-border">
                {cost.nodes.map((n) => {
                  const tp = tpByNode.get(n.id);
                  const under = target && tp && !tp.meetsTarget;
                  return (
                    <li
                      key={n.id}
                      className={cn('px-2.5 py-1.5 text-xs', under && 'bg-rose-500/10')}
                    >
                      <button
                        type="button"
                        onClick={() => select({ type: 'node', id: n.id })}
                        className="flex w-full items-center justify-between gap-2 text-left"
                      >
                        <span
                          className={cn(
                            'truncate',
                            under && 'font-medium text-rose-600 dark:text-rose-400',
                          )}
                        >
                          {n.label}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {n.external ? (
                            'not estimated'
                          ) : (
                            <>
                              {n.usageBased && n.monthlyUsd > 0 ? '~' : ''}
                              {usd(n.monthlyUsd)}/mo
                            </>
                          )}
                        </span>
                      </button>
                      {under && tp && (
                        <div className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">
                          {rpm(tp.requestsPerMinute)}/min ·{' '}
                          {tp.capReached
                            ? `max ${tp.recommendedUnits} ${tp.scaleProperty} — cannot reach target`
                            : `scale ${tp.scaleProperty} ${tp.currentUnits}→${tp.recommendedUnits} (+${usd(tp.addedMonthlyUsd)}/mo)`}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download size={16} /> Export CSV
            </Button>

            <p className="text-[11px] text-muted-foreground">
              Representative estimates for common SKUs in {cost.region} — not a billing quote. “~”
              marks usage-based services whose real cost depends on traffic or data volume.
            </p>
            {cost.hasExternalNodes && (
              <p className="text-[11px] text-muted-foreground">
                * Excludes non-Azure components — their cost is not estimated.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
