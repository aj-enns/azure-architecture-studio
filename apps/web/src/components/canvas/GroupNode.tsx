import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { GroupKind } from '@aar/shared';
import { cn } from '@/lib/utils.js';

export interface GroupNodeData extends Record<string, unknown> {
  kind: GroupKind;
  label: string;
}

/** Dashed container used to draw subscriptions, resource groups, VNets, subnets. */
const kindStyle: Record<GroupKind, string> = {
  subscription: 'border-slate-400/70',
  resourceGroup: 'border-sky-400/70',
  vnet: 'border-emerald-400/70',
  subnet: 'border-cyan-400/70',
  custom: 'border-muted-foreground/50',
};

export function GroupNode({ data, selected }: NodeProps): JSX.Element {
  const groupData = data as GroupNodeData;
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={120} lineClassName="!border-primary" handleClassName="!bg-primary !border-primary" />
      <div
        className={cn(
          'h-full w-full rounded-lg border-2 border-dashed bg-muted/20 backdrop-blur-[1px]',
          kindStyle[groupData.kind],
          selected && 'ring-2 ring-primary/40',
        )}
      >
        <span className="absolute left-2 top-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {groupData.label}
        </span>
      </div>
    </>
  );
}
