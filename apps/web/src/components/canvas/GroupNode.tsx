import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { GroupKind } from '@aas/shared';
import { cn } from '@/lib/utils.js';

export interface GroupNodeData extends Record<string, unknown> {
  kind: GroupKind;
  label: string;
}

/** Dashed container used to draw subscriptions, resource groups, VNets, subnets. */
const kindStyle: Record<GroupKind, { border: string; bg: string; header: string }> = {
  subscription: {
    border: 'border-slate-400/70',
    bg: 'bg-slate-400/[0.04]',
    header: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  },
  resourceGroup: {
    border: 'border-sky-400/70',
    bg: 'bg-sky-400/[0.04]',
    header: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  },
  vnet: {
    border: 'border-emerald-400/70',
    bg: 'bg-emerald-400/[0.04]',
    header: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  subnet: {
    border: 'border-cyan-400/70',
    bg: 'bg-cyan-400/[0.04]',
    header: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  },
  custom: {
    border: 'border-muted-foreground/50',
    bg: 'bg-muted/10',
    header: 'bg-muted text-muted-foreground',
  },
};

export function GroupNode({ data, selected }: NodeProps): JSX.Element {
  const groupData = data as GroupNodeData;
  const style = kindStyle[groupData.kind];
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={120}
        lineClassName="!border-primary"
        handleClassName="!bg-primary !border-primary"
      />
      <div
        className={cn(
          'h-full w-full rounded-lg border-2 border-dashed backdrop-blur-[1px]',
          style.border,
          style.bg,
          selected && 'ring-2 ring-primary/40',
        )}
      >
        <span
          className={cn(
            'absolute left-2 top-2 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
            style.header,
          )}
        >
          {groupData.label}
        </span>
      </div>
    </>
  );
}
