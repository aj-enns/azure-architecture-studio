import { Handle, Position, type NodeProps } from '@xyflow/react';
import { estimateNodeCost, getServiceDefinition, type ResilienceTier } from '@aar/shared';
import { ServiceIcon } from '@/components/ServiceIcon.js';
import { categoryBorderColor, categoryColor } from '@/lib/icons.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { useUiStore } from '@/store/uiStore.js';
import { cn } from '@/lib/utils.js';

export interface AzureNodeResiliency {
  slaPercent: number;
  tier: ResilienceTier;
  isWeakest: boolean;
}

export interface AzureNodeData extends Record<string, unknown> {
  serviceId: string;
  label: string;
  resiliency?: AzureNodeResiliency;
}

/** Heat-map tint applied to the node body when the SLA overlay is on. */
function slaTint(slaPercent: number): string {
  if (slaPercent >= 99.99) return 'bg-emerald-500/10';
  if (slaPercent >= 99.9) return 'bg-amber-500/10';
  return 'bg-rose-500/10';
}

function slaBadgeStyle(slaPercent: number): string {
  if (slaPercent >= 99.99)
    return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
  if (slaPercent >= 99.9)
    return 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400';
  return 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400';
}

export function AzureNode({ data, selected }: NodeProps): JSX.Element {
  const nodeData = data as AzureNodeData;
  const def = getServiceDefinition(nodeData.serviceId);
  const category = def?.category ?? 'management';
  const color = categoryColor[category];
  const region = useDiagramStore((s) => s.diagram.metadata.region);
  const cost = estimateNodeCost(nodeData.serviceId, region);
  const slaOverlay = useUiStore((s) => s.slaOverlay);
  const resiliency = slaOverlay ? nodeData.resiliency : undefined;

  return (
    <div
      className={cn(
        'aar-azure-node relative flex min-w-[160px] items-center gap-2.5 rounded-lg border border-l-4 bg-card px-3 py-2 shadow-sm transition-colors',
        categoryBorderColor[category],
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50',
        resiliency && slaTint(resiliency.slaPercent),
        resiliency?.isWeakest && 'ring-2 ring-rose-500/60',
      )}
      role="group"
      aria-label={`${def?.name ?? nodeData.serviceId}: ${nodeData.label}`}
    >
      {resiliency && (
        <span
          className={cn(
            'absolute -left-2 -top-2 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
            slaBadgeStyle(resiliency.slaPercent),
          )}
          title={
            resiliency.isWeakest
              ? `${resiliency.slaPercent}% SLA (${resiliency.tier}) \u2014 weakest link in this design`
              : `${resiliency.slaPercent}% SLA (${resiliency.tier})`
          }
        >
          {resiliency.slaPercent}%
        </span>
      )}
      {cost.monthlyUsd > 0 && (
        <span
          className="absolute -right-2 -top-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
          title={`Estimated monthly cost (${cost.basis})`}
        >
          {cost.usageBased ? '~' : ''}${cost.monthlyUsd}/mo
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted', color)}>
        <ServiceIcon category={category} slug={def?.icon} size={18} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-tight">{nodeData.label}</div>
        <div className="truncate text-xs text-muted-foreground">{def?.name ?? nodeData.serviceId}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
