import { useRef } from 'react';
import { Check, ChevronDown, ClipboardCheck, DollarSign, Download, FileCode2, FileJson, FilePlus2, Grid3x3, Image, LayoutGrid, Moon, PanelRight, Settings, ShieldAlert, ShieldCheck, Sparkles, Sun, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button.js';
import { DropdownItem, DropdownMenu } from '@/components/ui/DropdownMenu.js';
import { useTheme } from '@/lib/theme.js';
import { downloadJson, exportPng, exportSvg } from '@/lib/export.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { useUiStore } from '@/store/uiStore.js';

/** Top toolbar: document name, file actions, exports, theme toggle. */
export function Toolbar({ onOpenCommand }: { onOpenCommand: () => void }): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const name = useDiagramStore((s) => s.diagram.metadata.name);
  const setName = useDiagramStore((s) => s.setName);
  const reset = useDiagramStore((s) => s.reset);
  const relayout = useDiagramStore((s) => s.relayout);
  const importJson = useDiagramStore((s) => s.importJson);
  const exportJson = useDiagramStore((s) => s.exportJson);
  const showProperties = useUiStore((s) => s.showProperties);
  const toggleProperties = useUiStore((s) => s.toggleProperties);
  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const slaOverlay = useUiStore((s) => s.slaOverlay);
  const toggleSlaOverlay = useUiStore((s) => s.toggleSlaOverlay);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File): Promise<void> => {
    const text = await file.text();
    const result = importJson(text);
    if (!result.ok) window.alert(`Import failed: ${result.error}`);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <span className="text-sm font-semibold text-primary">Azure Architecture Review</span>
      <input
        aria-label="Diagram name"
        className="ml-2 h-8 w-56 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="ml-auto flex items-center gap-1">
        <Button variant="secondary" size="sm" onClick={() => togglePanel('ai')} title="Ask or modify with AI">
          <Sparkles size={16} /> AI assistant
        </Button>
        <Button variant="ghost" size="sm" onClick={() => togglePanel('validation')} title="Well-Architected review">
          <ShieldCheck size={16} /> Validate
        </Button>
        <Button variant="ghost" size="sm" onClick={() => togglePanel('cost')} title="Monthly cost estimate">
          <DollarSign size={16} /> Costs
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => togglePanel('resiliency')}
          title="Composite SLA, RPO and RTO"
        >
          <ShieldAlert size={16} /> Resiliency
        </Button>
        <Button variant="ghost" size="sm" onClick={() => togglePanel('review')} title="AI architecture review">
          <ClipboardCheck size={16} /> Review
        </Button>
        <Button variant="ghost" size="sm" onClick={relayout} title="Auto-arrange the diagram">
          <LayoutGrid size={16} /> Auto-layout
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenCommand} title="Command palette (Ctrl/Cmd+K)">
          ⌘K
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm('Start a new diagram? Unsaved changes are kept in your browser only.')) reset();
          }}
        >
          <FilePlus2 size={16} /> New
        </Button>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload size={16} /> Import
        </Button>

        <DropdownMenu
          label="Export"
          trigger={
            <Button variant="ghost" size="sm" title="Export the diagram">
              <Download size={16} /> Export <ChevronDown size={14} />
            </Button>
          }
        >
          <DropdownItem onSelect={() => downloadJson(name, exportJson())}>
            <FileJson size={16} /> JSON
          </DropdownItem>
          <DropdownItem onSelect={() => void exportPng(name)}>
            <Image size={16} /> PNG
          </DropdownItem>
          <DropdownItem onSelect={() => void exportSvg(name)}>
            <Download size={16} /> SVG
          </DropdownItem>
          <DropdownItem onSelect={() => togglePanel('iac')}>
            <FileCode2 size={16} /> IaC (Bicep / Terraform)
          </DropdownItem>
        </DropdownMenu>

        <DropdownMenu
          label="Settings"
          trigger={
            <Button variant="ghost" size="icon" title="Settings" aria-label="Settings">
              <Settings size={16} />
            </Button>
          }
        >
          <DropdownItem onSelect={toggleProperties}>
            <PanelRight size={16} />
            <span className="flex-1">Properties panel</span>
            {showProperties && <Check size={14} className="text-primary" />}
          </DropdownItem>
          <DropdownItem onSelect={toggleGrid}>
            <Grid3x3 size={16} />
            <span className="flex-1">Grid points</span>
            {showGrid && <Check size={14} className="text-primary" />}
          </DropdownItem>
          <DropdownItem onSelect={toggleSlaOverlay}>
            <ShieldAlert size={16} />
            <span className="flex-1">SLA overlay</span>
            {slaOverlay && <Check size={14} className="text-primary" />}
          </DropdownItem>
        </DropdownMenu>

        <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImport(file);
          e.target.value = '';
        }}
      />
    </header>
  );
}
