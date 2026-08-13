import { useMemo, useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import {
  describeNodeResiliency,
  getServiceDefinition,
  regionSupportsZones,
  type NodeResiliencyExplanation,
} from '@aar/shared';
import { Button } from '@/components/ui/Button.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { useUiStore } from '@/store/uiStore.js';

const TIER_LABEL: Record<NodeResiliencyExplanation['tier'], string> = {
  global: 'Global',
  nonzonal: 'Single zone',
  zoneRedundant: 'Zone redundant',
  multiRegion: 'Multi-region',
};

/** Right panel: edit the currently selected node, group, or the diagram itself. */
export function PropertiesPanel(): JSX.Element {
  const selection = useDiagramStore((s) => s.selection);
  const diagram = useDiagramStore((s) => s.diagram);
  const updateNodeLabel = useDiagramStore((s) => s.updateNodeLabel);
  const updateNodeProperty = useDiagramStore((s) => s.updateNodeProperty);
  const removeNode = useDiagramStore((s) => s.removeNode);
  const updateGroup = useDiagramStore((s) => s.updateGroup);
  const removeGroup = useDiagramStore((s) => s.removeGroup);
  const removeEdge = useDiagramStore((s) => s.removeEdge);
  const setName = useDiagramStore((s) => s.setName);
  const setRegion = useDiagramStore((s) => s.setRegion);
  const showResiliency = useUiStore((s) => s.activePanel === 'resiliency');

  const node =
    selection?.type === 'node' ? diagram.nodes.find((n) => n.id === selection.id) : undefined;
  const group =
    selection?.type === 'group' ? diagram.groups.find((g) => g.id === selection.id) : undefined;
  const edge =
    selection?.type === 'edge' ? diagram.edges.find((e) => e.id === selection.id) : undefined;

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-border bg-card"
      aria-label="Properties"
    >
      <div className="border-b border-border px-3 py-2 text-sm font-semibold">Properties</div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {node && (
          <NodeEditor
            key={node.id}
            node={node}
            region={diagram.metadata.region}
            showResiliency={showResiliency}
            onLabel={updateNodeLabel}
            onProperty={updateNodeProperty}
            onRemove={removeNode}
          />
        )}

        {group && (
          <div className="space-y-3">
            <Field label="Label">
              <input
                className="input"
                value={group.label}
                onChange={(e) => updateGroup(group.id, { label: e.target.value })}
              />
            </Field>
            <div className="text-xs text-muted-foreground">Kind: {group.kind}</div>
            <Button variant="destructive" size="sm" onClick={() => removeGroup(group.id)}>
              <Trash2 size={14} /> Delete group
            </Button>
          </div>
        )}

        {edge && (
          <div className="space-y-3">
            <div className="text-sm">Connection</div>
            <div className="text-xs text-muted-foreground">
              {edge.source} → {edge.target}
            </div>
            <Button variant="destructive" size="sm" onClick={() => removeEdge(edge.id)}>
              <Trash2 size={14} /> Delete connection
            </Button>
          </div>
        )}

        {!selection && (
          <div className="space-y-3">
            <Field label="Diagram name">
              <input
                className="input"
                value={diagram.metadata.name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Region">
              <input
                className="input"
                value={diagram.metadata.region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </Field>
            {!regionSupportsZones(diagram.metadata.region) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This region has no availability zones, so zone-redundant resources fall back to a
                single zone.
              </p>
            )}
            <div className="text-xs text-muted-foreground">
              {diagram.nodes.length} services · {diagram.groups.length} groups ·{' '}
              {diagram.edges.length} connections
            </div>
            <p className="text-xs text-muted-foreground">
              Select a service or group to edit its properties, or drag services from the palette.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function NodeEditor({
  node,
  region,
  showResiliency,
  onLabel,
  onProperty,
  onRemove,
}: {
  node: NonNullable<ReturnType<typeof useDiagramStore.getState>['diagram']['nodes'][number]>;
  region: string;
  showResiliency: boolean;
  onLabel: (id: string, label: string) => void;
  onProperty: (id: string, key: string, value: string | number | boolean) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  const def = getServiceDefinition(node.serviceId);
  const propertyKeys = Object.keys(node.properties);
  const explanation = useMemo(
    () => (showResiliency ? describeNodeResiliency(node.serviceId, node.properties, region) : null),
    [showResiliency, node.serviceId, node.properties, region],
  );

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {def?.name ?? node.serviceId}
      </div>
      <Field label="Resource Name">
        <input
          className="input"
          value={node.label}
          onChange={(e) => onLabel(node.id, e.target.value)}
        />
      </Field>

      {explanation && (
        <ResiliencyDescription
          explanation={explanation}
          onApply={(setting) =>
            onProperty(node.id, setting.property, coercePropertyValue(setting.value))
          }
        />
      )}

      {propertyKeys.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Configuration</div>
          {propertyKeys.map((key) => {
            const value = node.properties[key];
            if (value === undefined) return null;
            if (typeof value === 'boolean') {
              return (
                <BooleanField
                  key={key}
                  label={humanizeLabel(key)}
                  checked={value}
                  onChange={(checked) => onProperty(node.id, key, checked)}
                />
              );
            }
            return (
              <Field key={key} label={humanizeLabel(key)}>
                <PropertyInput value={value} onChange={(v) => onProperty(node.id, key, v)} />
              </Field>
            );
          })}
        </div>
      )}

      {def?.docsUrl && (
        <a
          href={def.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-xs text-primary underline"
        >
          Documentation ↗
        </a>
      )}

      <Button variant="destructive" size="sm" onClick={() => onRemove(node.id)}>
        <Trash2 size={14} /> Delete service
      </Button>
    </div>
  );
}

/** Explains the selected node's resiliency posture and how to strengthen it.
 *  Shown in the properties panel while the Resiliency panel is open. */
function ResiliencyDescription({
  explanation,
  onApply,
}: {
  explanation: NodeResiliencyExplanation;
  onApply: (setting: { property: string; value: string }) => void;
}): JSX.Element {
  return (
    <section
      className="space-y-2 rounded-md border border-border bg-background p-2.5"
      aria-label="Resiliency description"
    >
      <div className="flex items-center gap-1.5">
        <ShieldAlert size={14} className="text-primary" />
        <span className="text-xs font-semibold">Resiliency</span>
        <span className="ml-auto text-xs font-semibold tabular-nums">
          {explanation.slaPercent}%
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{explanation.summary}</p>
      {explanation.atBestTier ? (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          This is the strongest tier available for this service.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended
          </div>
          {explanation.recommendations.map((rec) => (
            <div key={rec.tier} className="rounded border border-border p-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{TIER_LABEL[rec.tier]}</span>
                <span className="ml-auto text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {rec.slaPercent}%
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{rec.description}</p>
              {rec.settings.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-1.5 h-7 text-[11px]"
                  onClick={() => rec.settings.forEach(onApply)}
                >
                  Apply recommended settings
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Coerce a recommended string value into the type the property expects. */
function coercePropertyValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  if (value.trim() !== '' && Number.isFinite(n)) return n;
  return value;
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Checkbox property editor: label and checkbox share a row with the checkbox
 *  right-aligned so multiple toggles line up cleanly. */
function BooleanField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-primary"
      />
    </label>
  );
}

const LABEL_ACRONYMS: Record<string, string> = { sku: 'SKU', id: 'ID', url: 'URL', ip: 'IP' };

/** Turn a camelCase or snake_case property key into a human-friendly label,
 *  e.g. "zoneRedundant" -> "Zone Redundant", "sku" -> "SKU". */
function humanizeLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(
      (word) => LABEL_ACRONYMS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** Text/number property editor that keeps the raw keystrokes so numeric coercion
 *  never reverts an in-progress edit. Remounts per node via NodeEditor's key. */
function PropertyInput({
  value,
  onChange,
}: {
  value: string | number;
  onChange: (value: string | number) => void;
}): JSX.Element {
  const isNumber = typeof value === 'number';
  const [text, setText] = useState(String(value));

  return (
    <input
      className="input"
      inputMode={isNumber ? 'decimal' : undefined}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = Number(raw);
        onChange(isNumber && raw !== '' && Number.isFinite(n) ? n : raw);
      }}
    />
  );
}
