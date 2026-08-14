import { useReactFlow, useViewport } from '@xyflow/react';
import {
  ChevronUp,
  DollarSign,
  Grid3x3,
  Hand,
  Layers3,
  LayoutGrid,
  Minus,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { DropdownCheckboxItem, DropdownMenu } from '@/components/ui/DropdownMenu.js';
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
        <span className="hidden items-center gap-1.5 whitespace-nowrap md:flex">
          <Hand size={12} aria-hidden />
          <kbd className="font-sans font-medium text-foreground">Ctrl + drag</kbd> to pan
        </span>
      </div>

      <div className="flex items-center gap-1">
        <DropdownMenu
          label="Sidebars"
          side="top"
          closeOnSelect={false}
          trigger={
            <StatusMenuTrigger title="Show or hide workspace sidebars" count={Number(showPalette) + Number(showProperties)}>
              <PanelsTopLeft size={13} /> Sidebars
            </StatusMenuTrigger>
          }
        >
          <DropdownCheckboxItem checked={showPalette} onCheckedChange={togglePalette}>
            <PanelLeft size={14} /> Services
          </DropdownCheckboxItem>
          <DropdownCheckboxItem checked={showProperties} onCheckedChange={toggleProperties}>
            <PanelRight size={14} /> Properties
          </DropdownCheckboxItem>
        </DropdownMenu>
        <DropdownMenu
          label="Overlays"
          side="top"
          closeOnSelect={false}
          trigger={
            <StatusMenuTrigger
              title="Show or hide canvas overlays"
              count={Number(showGrid) + Number(slaOverlay) + Number(costOverlay)}
            >
              <Layers3 size={13} /> Overlays
            </StatusMenuTrigger>
          }
        >
          <DropdownCheckboxItem checked={showGrid} onCheckedChange={toggleGrid}>
            <Grid3x3 size={14} /> Grid points
          </DropdownCheckboxItem>
          <DropdownCheckboxItem checked={slaOverlay} onCheckedChange={toggleSlaOverlay}>
            <ShieldAlert size={14} /> SLA indicators
          </DropdownCheckboxItem>
          <DropdownCheckboxItem checked={costOverlay} onCheckedChange={toggleCostOverlay}>
            <DollarSign size={14} /> Cost badges
          </DropdownCheckboxItem>
        </DropdownMenu>
        <Divider className="mx-1" />
        <ZoomControls />
      </div>
    </footer>
  );
}

function Divider({ className }: { className?: string }): JSX.Element {
  return <span className={cn('h-3.5 w-px bg-border', className)} aria-hidden />;
}

function StatusMenuTrigger({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <span className="min-w-3 text-center tabular-nums text-foreground">{count}</span>
      <ChevronUp size={11} aria-hidden />
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
