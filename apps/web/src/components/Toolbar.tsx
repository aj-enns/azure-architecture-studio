import { useRef } from 'react';
import { Download, FileJson, FilePlus2, Image, Moon, Sparkles, Sun, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button.js';
import { useTheme } from '@/lib/theme.js';
import { downloadJson, exportPng, exportSvg } from '@/lib/export.js';
import { useDiagramStore } from '@/store/diagramStore.js';

/** Top toolbar: document name, file actions, exports, theme toggle. */
export function Toolbar({
  onOpenCommand,
  onToggleAi,
}: {
  onOpenCommand: () => void;
  onToggleAi: () => void;
}): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const name = useDiagramStore((s) => s.diagram.metadata.name);
  const setName = useDiagramStore((s) => s.setName);
  const reset = useDiagramStore((s) => s.reset);
  const importJson = useDiagramStore((s) => s.importJson);
  const exportJson = useDiagramStore((s) => s.exportJson);
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
        <Button variant="secondary" size="sm" onClick={onToggleAi} title="Generate with AI">
          <Sparkles size={16} /> Generate
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
        <Button variant="ghost" size="sm" onClick={() => downloadJson(name, exportJson())}>
          <FileJson size={16} /> JSON
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void exportPng(name)}>
          <Image size={16} /> PNG
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void exportSvg(name)}>
          <Download size={16} /> SVG
        </Button>
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
