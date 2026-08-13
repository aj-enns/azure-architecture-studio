import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { cn } from '@/lib/utils.js';

/**
 * Custom smoothstep edge whose label is rendered through {@link EdgeLabelRenderer}.
 *
 * React Flow paints each edge into its own `<svg>`, so a default (in-SVG) label
 * can be covered by a neighbouring connector that is painted later. The
 * `EdgeLabelRenderer` portals the label into the dedicated `edgelabel-renderer`
 * layer, which sits above every connector, so labels always stay on top.
 */
export function AzureEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  selected,
}: EdgeProps): JSX.Element {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'nodrag nopan pointer-events-none absolute rounded border border-border bg-card/95 px-1.5 py-0.5 text-[11px] font-semibold',
              selected ? 'text-primary' : 'text-foreground',
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
