import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getServiceDefinition } from '@aar/shared';
import { categoryColor, iconForCategory } from '@/lib/icons.js';
import { cn } from '@/lib/utils.js';

export interface AzureNodeData extends Record<string, unknown> {
  serviceId: string;
  label: string;
}

export function AzureNode({ data, selected }: NodeProps): JSX.Element {
  const nodeData = data as AzureNodeData;
  const def = getServiceDefinition(nodeData.serviceId);
  const Icon = iconForCategory(def?.category ?? 'management');
  const color = categoryColor[def?.category ?? 'management'];

  return (
    <div
      className={cn(
        'flex min-w-[160px] items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50',
      )}
      role="group"
      aria-label={`${def?.name ?? nodeData.serviceId}: ${nodeData.label}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted', color)}>
        <Icon size={18} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-tight">{nodeData.label}</div>
        <div className="truncate text-xs text-muted-foreground">{def?.name ?? nodeData.serviceId}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}
