import { useReactFlow, useViewport } from '@xyflow/react';
import { DollarSign, Grid3x3, Hand, LayoutGrid, Minus, PanelLeft, PanelRight, Plus, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { useUiStore } from '@/store/uiStore.js';
import { MAX_ZOOM, MIN_ZOOM } from '@/components/canvas/Canvas.js';

/** Bottom status bar (VS Code / PowerPoint style): diagram stats, view toggles and zoom. */
export function StatusBar(): JSX.Element {
  const nodeCount = useDiagramStore((s) => s.diagram.nodes.length);
  const groupCount = useDiagramStore((s) => s.diagram.groups.length);
  const edgeCount = useDiagramStore((s) => s.diagram.edges.length);
  const region = useDiagramStore((s) => s.diagram.metadata.region);
  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const showProperties = useUiStore((s) => s.showProperties);
  const toggleProperties = useUiStore((s) => s.toggleProperties);
  const showPalette = useUiStore((s) => s.showPalette);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const slaOverlay = useUiStore((s) => s.slaOverlay);
  const toggleSlaOverlay = useUiStore((s) => s.toggleSlaOverlay);
  const costOverlay = useUiStore((s) => s.costOverlay);
  const toggleCostOverlay = useUiStore((s) => s.toggleCostOverlay);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate tabular-nums">
          {nodeCount} services · {groupCount} groups · {edgeCount} connections
        </span>
        {region && (
          <>
            <Divider />
            <span>{region}</span>
          </>
        )}
        <Divider />
        <span className="hidden items-center gap-1.5 md:flex">
          <Hand size={12} aria-hidden />
          <kbd className="font-sans font-medium text-foreground">Ctrl + drag</kbd> to pan
        </span>
      </div>

      <div className="flex items-center gap-1">
        <StatusToggle active={showPalette} onClick={togglePalette} title="Toggle services panel">
          <PanelLeft size={13} /> Services
        </StatusToggle>
        <StatusToggle active={showProperties} onClick={toggleProperties} title="Toggle properties panel">
          <PanelRight size={13} /> Properties
        </StatusToggle>
        <StatusToggle active={showGrid} onClick={toggleGrid} title="Toggle grid points">
          <Grid3x3 size={13} /> Grid
        </StatusToggle>
        <StatusToggle active={slaOverlay} onClick={toggleSlaOverlay} title="Toggle SLA overlay">
          <ShieldAlert size={13} /> SLA
        </StatusToggle>
        <StatusToggle active={costOverlay} onClick={toggleCostOverlay} title="Toggle cost overlay">
          <DollarSign size={13} /> Cost
        </StatusToggle>
        <Divider className="mx-1" />
        <ZoomControls />
      </div>
    </footer>
  );
}

function Divider({ className }: { className?: string }): JSX.Element {
  return <span className={cn('h-3.5 w-px bg-border', className)} aria-hidden />;
}

function StatusToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Isolated so live viewport updates re-render only the zoom widget, not the whole bar. */
function ZoomControls(): JSX.Element {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const relayout = useDiagramStore((s) => s.relayout);
  const pct = Math.round(zoom * 100);

  return (
    <div className="flex items-center gap-1">
      <IconButton title="Auto-arrange the diagram" onClick={() => relayout()}>
        <LayoutGrid size={13} />
      </IconButton>
      <Divider className="mx-0.5 h-4" />
      <IconButton title="Zoom out" onClick={() => void zoomOut({ duration: 200 })}>
        <Minus size={13} />
      </IconButton>
      <input
        type="range"
        aria-label="Zoom level"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        onChange={(e) => void zoomTo(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer accent-primary"
      />
      <IconButton title="Zoom in" onClick={() => void zoomIn({ duration: 200 })}>
        <Plus size={13} />
      </IconButton>
      <button
        type="button"
        title="Fit to view"
        aria-label="Fit diagram to view"
        onClick={() => void fitView({ padding: 0.2, duration: 300 })}
        className="min-w-[3rem] rounded px-1 py-0.5 text-center font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {pct}%
      </button>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
