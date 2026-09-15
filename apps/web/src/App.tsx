import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AiPanel } from '@/components/AiPanel.js';
import { Canvas } from '@/components/canvas/Canvas.js';
import { CommandPalette } from '@/components/CommandPalette.js';
import { CostPanel } from '@/components/CostPanel.js';
import { IacPanel } from '@/components/IacPanel.js';
import { Palette } from '@/components/Palette.js';
import { PropertiesPanel } from '@/components/PropertiesPanel.js';
import { RepositoryImportDialog } from '@/components/RepositoryImportDialog.js';
import { ResiliencyPanel } from '@/components/ResiliencyPanel.js';
import { ReviewPanel } from '@/components/ReviewPanel.js';
import { StatusBar } from '@/components/StatusBar.js';
import { ValidationPanel } from '@/components/ValidationPanel.js';
import { Toolbar } from '@/components/Toolbar.js';
import { useUiStore } from '@/store/uiStore.js';
import { PrivacyCenter } from '@/components/PrivacyNotice.js';

export function App(): JSX.Element {
  const [commandOpen, setCommandOpen] = useState(false);
  const [repositoryImportOpen, setRepositoryImportOpen] = useState(false);
  const showProperties = useUiStore((s) => s.showProperties);
  const showPalette = useUiStore((s) => s.showPalette);
  const activePanel = useUiStore((s) => s.activePanel);
  const closePanel = useUiStore((s) => s.closePanel);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Toolbar
        onOpenCommand={() => setCommandOpen(true)}
        onOpenRepositoryImport={() => setRepositoryImportOpen(true)}
      />
      <ReactFlowProvider>
        <div className="flex min-h-0 flex-1">
          {showPalette && <Palette />}
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
        <PrivacyCenter />
        <StatusBar />
      </ReactFlowProvider>
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenRepositoryImport={() => setRepositoryImportOpen(true)}
      />
      <RepositoryImportDialog
        open={repositoryImportOpen}
        onClose={() => setRepositoryImportOpen(false)}
      />
    </div>
  );
}

export default App;
