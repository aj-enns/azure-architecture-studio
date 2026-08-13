import { useState } from 'react';
import { AiPanel } from '@/components/AiPanel.js';
import { Canvas } from '@/components/canvas/Canvas.js';
import { CommandPalette } from '@/components/CommandPalette.js';
import { CostPanel } from '@/components/CostPanel.js';
import { IacPanel } from '@/components/IacPanel.js';
import { Palette } from '@/components/Palette.js';
import { PropertiesPanel } from '@/components/PropertiesPanel.js';
import { ResiliencyPanel } from '@/components/ResiliencyPanel.js';
import { ReviewPanel } from '@/components/ReviewPanel.js';
import { ValidationPanel } from '@/components/ValidationPanel.js';
import { Toolbar } from '@/components/Toolbar.js';
import { useUiStore } from '@/store/uiStore.js';

export function App(): JSX.Element {
  const [commandOpen, setCommandOpen] = useState(false);
  const showProperties = useUiStore((s) => s.showProperties);
  const activePanel = useUiStore((s) => s.activePanel);
  const closePanel = useUiStore((s) => s.closePanel);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Toolbar onOpenCommand={() => setCommandOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <main className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        <AiPanel open={activePanel === 'ai'} onClose={closePanel} />
        <ValidationPanel open={activePanel === 'validation'} onClose={closePanel} />
        <CostPanel open={activePanel === 'cost'} onClose={closePanel} />
        <ResiliencyPanel open={activePanel === 'resiliency'} onClose={closePanel} />
        <ReviewPanel open={activePanel === 'review'} onClose={closePanel} />
        <IacPanel open={activePanel === 'iac'} onClose={closePanel} />
        {showProperties && <PropertiesPanel />}
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}

export default App;
