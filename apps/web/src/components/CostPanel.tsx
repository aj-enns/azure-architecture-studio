import { useMemo } from 'react';
import { DollarSign, Download, X } from 'lucide-react';
import { estimateDiagramCost, getServiceDefinition, type ServiceCategory } from '@aar/shared';
import { Button } from '@/components/ui/Button.js';
import { downloadCsv } from '@/lib/export.js';
import { useDiagramStore } from '@/store/diagramStore.js';

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

function usd(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/** Deterministic monthly cost estimate panel (curated representative pricing). */
export function CostPanel({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const diagram = useDiagramStore((s) => s.diagram);
  const cost = useMemo(() => estimateDiagramCost(diagram), [diagram]);

  if (!open) return null;

  const exportCsv = (): void => {
    const rows = [
      ['Service', 'Type', 'Category', 'Region', 'Monthly USD', 'Usage-based'],
      ...cost.nodes.map((n) => [
        n.label,
        getServiceDefinition(n.serviceId)?.name ?? n.serviceId,
        getServiceDefinition(n.serviceId)?.category ?? '',
        cost.region,
        String(n.monthlyUsd),
        n.usageBased ? 'yes' : 'no',
      ]),
      ['TOTAL', '', '', cost.region, String(cost.totalMonthlyUsd), ''],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadCsv(`${diagram.metadata.name}-costs`, csv);
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <DollarSign size={16} className="text-primary" />
        <span className="text-sm font-semibold">Monthly cost estimate</span>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close cost panel">
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Total ({cost.region})</span>
            <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {cost.hasUsageBased ? '~' : ''}
              {usd(cost.totalMonthlyUsd)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">/mo</span>
            </span>
          </div>
        </div>

        {diagram.nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add or generate services to estimate monthly cost.
          </p>
        ) : (
          <>
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-2.5 py-1.5 text-xs font-semibold">By category</div>
              <ul className="divide-y divide-border">
                {cost.byCategory.map(({ category, monthlyUsd }) => (
                  <li key={category} className="flex items-center justify-between px-2.5 py-1.5 text-xs">
                    <span>{CATEGORY_LABEL[category]}</span>
                    <span className="tabular-nums text-muted-foreground">{usd(monthlyUsd)}/mo</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border border-border">
              <div className="border-b border-border px-2.5 py-1.5 text-xs font-semibold">By service</div>
              <ul className="divide-y divide-border">
                {cost.nodes.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                    <span className="truncate">{n.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {n.usageBased && n.monthlyUsd > 0 ? '~' : ''}
                      {usd(n.monthlyUsd)}/mo
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download size={16} /> Export CSV
            </Button>

            <p className="text-[11px] text-muted-foreground">
              Representative estimates for common SKUs in {cost.region} — not a billing quote. “~”
              marks usage-based services whose real cost depends on traffic or data volume.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
