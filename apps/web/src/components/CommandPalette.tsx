import { Command } from 'cmdk';
import { useEffect } from 'react';
import { azureServiceCatalog, type Diagram, type GroupKind } from '@aas/shared';
import { importArmTemplate, importFromAzure } from '@/lib/api.js';
import { downloadJson, exportPng, exportSvg } from '@/lib/export.js';
import { useTheme } from '@/lib/theme.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { useUiStore, type PanelId } from '@/store/uiStore.js';
import { usePrivacyStore } from '@/lib/privacy.js';

const groupKinds: { kind: GroupKind; label: string }[] = [
  { kind: 'subscription', label: 'Subscription' },
  { kind: 'resourceGroup', label: 'Resource Group' },
  { kind: 'vnet', label: 'Virtual Network' },
  { kind: 'subnet', label: 'Subnet' },
  { kind: 'custom', label: 'Custom group' },
];

const panels: { id: PanelId; label: string }[] = [
  { id: 'ai', label: 'AI assistant' },
  { id: 'validation', label: 'Validate (Well-Architected review)' },
  { id: 'cost', label: 'Costs (monthly estimate)' },
  { id: 'resiliency', label: 'Resiliency (SLA, RPO, RTO)' },
  { id: 'review', label: 'AI architecture review' },
  { id: 'iac', label: 'Generate IaC (Bicep / Terraform)' },
];

/** Prompts for a JSON file via a transient input, then imports it. */
async function pickAndImport(
  importJson: (json: string) => { ok: true } | { ok: false; error: string },
): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const result = importJson(await file.text());
    if (!result.ok) window.alert(`Import failed: ${result.error}`);
  };
  input.click();
}

/** Prompts for a compiled ARM/Bicep template file, then imports it via the API. */
async function pickAndImportArm(load: (diagram: Diagram) => void): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const template = JSON.parse(await file.text());
      load(await importArmTemplate(template, file.name.replace(/\.[^.]+$/, '')));
    } catch (e) {
      window.alert(`Import failed: ${e instanceof Error ? e.message : 'Invalid template'}`);
    }
  };
  input.click();
}

/** Prompts for a subscription + resource group, then imports live via the API. */
async function importAzureResourceGroup(load: (diagram: Diagram) => void): Promise<void> {
  const subscriptionId = window.prompt('Azure subscription id (GUID):')?.trim();
  if (!subscriptionId) return;
  const resourceGroup = window.prompt('Resource group name:')?.trim();
  if (!resourceGroup) return;
  try {
    load(await importFromAzure(subscriptionId, resourceGroup));
  } catch (e) {
    window.alert(`Azure import failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}

/** Command palette (Ctrl/Cmd+K): open panels, run diagram actions, add services. */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenRepositoryImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenRepositoryImport: () => void;
}): JSX.Element {
  const addNode = useDiagramStore((s) => s.addNode);
  const addGroup = useDiagramStore((s) => s.addGroup);
  const exportJson = useDiagramStore((s) => s.exportJson);
  const importJson = useDiagramStore((s) => s.importJson);
  const load = useDiagramStore((s) => s.load);
  const relayout = useDiagramStore((s) => s.relayout);
  const reset = useDiagramStore((s) => s.reset);
  const name = useDiagramStore((s) => s.diagram.metadata.name);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const toggleProperties = useUiStore((s) => s.toggleProperties);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const toggleSlaOverlay = useUiStore((s) => s.toggleSlaOverlay);
  const toggleCostOverlay = useUiStore((s) => s.toggleCostOverlay);
  const { toggleTheme } = useTheme();
  const iacImportEnabled = usePrivacyStore((state) => state.health?.iacImportEnabled === true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return <></>;

  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  // Add near the center of the current viewport.
  const center = () => ({ x: 200 + Math.random() * 200, y: 120 + Math.random() * 160 });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={() => onOpenChange(false)}
    >
      <Command
        label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          autoFocus
          placeholder="Type a command or search services…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            No results.
          </Command.Empty>

          <Command.Group
            heading="Panels"
            className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
          >
            {panels.map((p) => (
              <Item key={p.id} onSelect={() => run(() => togglePanel(p.id))}>
                {p.label}
              </Item>
            ))}
          </Command.Group>

          <Command.Group
            heading="Diagram"
            className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
          >
            <Item onSelect={() => run(relayout)}>Auto-layout</Item>
            <Item
              onSelect={() =>
                run(() => {
                  if (
                    window.confirm(
                      'Start a new diagram? Unsaved changes are kept in your browser only.',
                    )
                  )
                    reset();
                })
              }
            >
              New diagram
            </Item>
            <Item onSelect={() => run(() => void pickAndImport(importJson))}>Import JSON…</Item>
            {iacImportEnabled && (
              <Item onSelect={() => run(() => void pickAndImportArm(load))}>
                Import ARM/Bicep template (JSON)…
              </Item>
            )}
            {iacImportEnabled && (
              <Item onSelect={() => run(onOpenRepositoryImport)}>Import Git repository…</Item>
            )}
            <Item onSelect={() => run(() => void importAzureResourceGroup(load))}>
              Import from Azure (resource group)…
            </Item>
          </Command.Group>

          <Command.Group
            heading="Export"
            className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
          >
            <Item onSelect={() => run(() => void exportPng(name))}>Export as PNG</Item>
            <Item onSelect={() => run(() => void exportSvg(name))}>Export as SVG</Item>
            <Item onSelect={() => run(() => downloadJson(name, exportJson()))}>Export as JSON</Item>
          </Command.Group>

          <Command.Group
            heading="View"
            className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
          >
            <Item onSelect={() => run(togglePalette)}>Toggle Services panel</Item>
            <Item onSelect={() => run(toggleProperties)}>Toggle Properties panel</Item>
            <Item onSelect={() => run(toggleGrid)}>Toggle Grid points</Item>
            <Item onSelect={() => run(toggleSlaOverlay)}>Toggle SLA overlay</Item>
            <Item onSelect={() => run(toggleCostOverlay)}>Toggle Cost overlay</Item>
            <Item onSelect={() => run(toggleTheme)}>Toggle theme</Item>
          </Command.Group>

          <Command.Group
            heading="Add group"
            className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
          >
            {groupKinds.map((g) => (
              <Item key={g.kind} onSelect={() => run(() => addGroup(g.kind, center()))}>
                {g.label}
              </Item>
            ))}
          </Command.Group>

          <Command.Group
            heading="Add service"
            className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
          >
            {azureServiceCatalog.map((s) => (
              <Item
                key={s.id}
                value={`${s.name} ${s.description}`}
                onSelect={() => run(() => addNode(s.id, center()))}
              >
                {s.name}
              </Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

function Item({
  children,
  value,
  onSelect,
}: {
  children: React.ReactNode;
  value?: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center rounded-md px-3 py-2 text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      {children}
    </Command.Item>
  );
}
