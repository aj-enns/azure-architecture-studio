import { useState } from 'react';
import { AiPanel } from '@/components/AiPanel.js';
import { Canvas } from '@/components/canvas/Canvas.js';
import { CommandPalette } from '@/components/CommandPalette.js';
import { CostPanel } from '@/components/CostPanel.js';
import { IacPanel } from '@/components/IacPanel.js';
import { Palette } from '@/components/Palette.js';
import { PropertiesPanel } from '@/components/PropertiesPanel.js';
import { ValidationPanel } from '@/components/ValidationPanel.js';
import { Toolbar } from '@/components/Toolbar.js';
import { useUiStore } from '@/store/uiStore.js';

export function App(): JSX.Element {
  const [commandOpen, setCommandOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [iacOpen, setIacOpen] = useState(false);
  const showProperties = useUiStore((s) => s.showProperties);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Toolbar
        onOpenCommand={() => setCommandOpen(true)}
        onToggleAi={() => setAiOpen((v) => !v)}
        onToggleValidation={() => setValidationOpen((v) => !v)}
        onToggleCost={() => setCostOpen((v) => !v)}
        onToggleIac={() => setIacOpen((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <main className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
        <ValidationPanel open={validationOpen} onClose={() => setValidationOpen(false)} />
        <CostPanel open={costOpen} onClose={() => setCostOpen(false)} />
        <IacPanel open={iacOpen} onClose={() => setIacOpen(false)} />
        {showProperties && <PropertiesPanel />}
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}

export default App;
