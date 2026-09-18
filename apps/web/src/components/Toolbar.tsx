import { useRef } from 'react';
import {
  ChevronDown,
  ClipboardCheck,
  Cloud,
  Command,
  DollarSign,
  Download,
  FileCode2,
  FileJson,
  FilePlus2,
  Folder,
  Image,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button.js';
import { DropdownItem, DropdownMenu } from '@/components/ui/DropdownMenu.js';
import { importArmTemplate, importFromAzure } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';
import { useTheme } from '@/lib/theme.js';
import { downloadJson, exportPng, exportSvg } from '@/lib/export.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { useUiStore, type PanelId } from '@/store/uiStore.js';
import { usePrivacyStore } from '@/lib/privacy.js';
import aasLogo from '@/assets/aas-logo.png';

/** Analysis lenses that share the right rail — rendered as a segmented tab strip. */
const insightLenses: { id: PanelId; label: string; icon: LucideIcon; title: string }[] = [
  { id: 'validation', label: 'Validate', icon: ShieldCheck, title: 'Well-Architected review' },
  { id: 'cost', label: 'Costs', icon: DollarSign, title: 'Monthly cost estimate' },
  { id: 'resiliency', label: 'Resiliency', icon: ShieldAlert, title: 'Composite SLA, RPO and RTO' },
  { id: 'review', label: 'Review', icon: ClipboardCheck, title: 'AI architecture review' },
];

/** Top toolbar: document context on the left, analysis lenses and tools on the right. */
export function Toolbar({
  onOpenCommand,
  onOpenRepositoryImport,
}: {
  onOpenCommand: () => void;
  onOpenRepositoryImport: () => void;
}): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const iacImportEnabled = usePrivacyStore((state) => state.health?.iacImportEnabled === true);
  const name = useDiagramStore((s) => s.diagram.metadata.name);
  const setName = useDiagramStore((s) => s.setName);
  const reset = useDiagramStore((s) => s.reset);
  const importJson = useDiagramStore((s) => s.importJson);
  const load = useDiagramStore((s) => s.load);
  const exportJson = useDiagramStore((s) => s.exportJson);
  const activePanel = useUiStore((s) => s.activePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const fileRef = useRef<HTMLInputElement>(null);
  const armFileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File): Promise<void> => {
    const text = await file.text();
    const result = importJson(text);
    if (!result.ok) window.alert(`Import failed: ${result.error}`);
  };

  // Compiled ARM/Bicep template (JSON) -> diagram via the deterministic API import.
  const handleImportArm = async (file: File): Promise<void> => {
    try {
      const template = JSON.parse(await file.text());
      load(await importArmTemplate(template, file.name.replace(/\.[^.]+$/, '')));
    } catch (e) {
      window.alert(`Import failed: ${e instanceof Error ? e.message : 'Invalid template'}`);
    }
  };

  const handleImportAzure = async (): Promise<void> => {
    const subscriptionId = window.prompt('Azure subscription id (GUID):')?.trim();
    if (!subscriptionId) return;
    const resourceGroup = window.prompt('Resource group name:')?.trim();
    if (!resourceGroup) return;
    try {
      load(await importFromAzure(subscriptionId, resourceGroup));
    } catch (e) {
      window.alert(`Azure import failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-1">
      <div className="flex shrink-0 items-center gap-2">
        <img
          src={aasLogo}
          alt=""
          aria-hidden="true"
          className="h-9 w-[57px] object-contain"
        />
        <span className="text-sm font-semibold text-primary">Azure Architecture Studio</span>
      </div>
      <input
        aria-label="Diagram name"
        className="ml-1 h-8 w-56 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {/* File / document actions — grouped so destructive "New" leaves the hot row. */}
      <DropdownMenu
        label="File"
        trigger={
          <Button variant="ghost" size="sm" title="New, import and export">
            <Folder size={16} /> File <ChevronDown size={14} />
          </Button>
        }
      >
        <DropdownItem
          onSelect={() => {
            if (
              window.confirm('Start a new diagram? Unsaved changes are kept in your browser only.')
            )
              reset();
          }}
        >
          <FilePlus2 size={16} /> New diagram
        </DropdownItem>
        <DropdownItem onSelect={() => fileRef.current?.click()}>
          <Upload size={16} /> Import JSON…
        </DropdownItem>
        {iacImportEnabled && (
          <DropdownItem onSelect={() => armFileRef.current?.click()}>
            <FileCode2 size={16} /> Import ARM/Bicep template (JSON)…
          </DropdownItem>
        )}
        {iacImportEnabled && (
          <DropdownItem onSelect={onOpenRepositoryImport}>
            <Folder size={16} /> Import Git repository…
          </DropdownItem>
        )}
        {!iacImportEnabled && <MenuLabel>IaC import requires self-hosted mode</MenuLabel>}
        <DropdownItem onSelect={() => void handleImportAzure()}>
          <Cloud size={16} /> Import from Azure (resource group)…
        </DropdownItem>
        <MenuSeparator />
        <MenuLabel>Export</MenuLabel>
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

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Hero action: AI-assisted create / edit. */}
        <Button
          variant={activePanel === 'ai' ? 'default' : 'secondary'}
          size="sm"
          onClick={() => togglePanel('ai')}
          title="Build or ask with AI"
        >
          <Sparkles size={16} /> AI assistant
        </Button>

        {/* Analysis lenses — one open at a time, so a segmented toggle reflects state. */}
        <div
          role="tablist"
          aria-label="Analysis lenses"
          className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
        >
          {insightLenses.map(({ id, label, icon: Icon, title }) => {
            const active = activePanel === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                title={title}
                onClick={() => togglePanel(id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon size={15} /> {label}
              </button>
            );
          })}
        </div>

        <ToolbarSeparator />

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenCommand}
          title="Command palette (Ctrl/Cmd+K)"
          aria-label="Command palette"
        >
          <Command size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
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
      <input
        ref={armFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportArm(file);
          e.target.value = '';
        }}
      />
    </header>
  );
}

/** Vertical divider between weakly-coupled toolbar groups. */
function ToolbarSeparator(): JSX.Element {
  return <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />;
}

/** Non-interactive section heading inside a dropdown menu. */
function MenuLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{children}</div>;
}

/** Horizontal divider inside a dropdown menu. */
function MenuSeparator(): JSX.Element {
  return <div className="my-1 h-px bg-border" aria-hidden />;
}
