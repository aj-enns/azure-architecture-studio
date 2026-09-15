import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FolderOpen, Github, Link, X } from 'lucide-react';
import { Button } from '@/components/ui/Button.js';
import { importRepoFromGitHub } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import {
  localPath,
  parseLocalFolder,
  selectFolderFiles,
  type FolderSelection,
} from '@/lib/folderImport.js';
import { usePrivacyStore } from '@/lib/privacy.js';
import { PrivacyNotice } from './PrivacyNotice.js';

type ImportSource = 'url' | 'folder';

export function RepositoryImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const load = useDiagramStore((state) => state.load);
  const folderRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<FolderSelection | null>(null);
  const enabled = usePrivacyStore((state) => state.health?.iacImportEnabled === true);

  useEffect(() => {
    if (!open) setSelection(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loading, onClose, open]);

  if (!open || !enabled) return null;

  const importUrl = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const githubUrl = url.trim();
    if (!githubUrl) {
      setError('Enter a GitHub repository URL.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      load(await importRepoFromGitHub(githubUrl));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'GitHub import failed.');
    } finally {
      setLoading(false);
    }
  };

  const importFolder = async (): Promise<void> => {
    if (!selection?.files.length) return;
    setLoading(true);
    setError(null);
    try {
      load(await parseLocalFolder(selection));
      usePrivacyStore.setState({
        lastTransfer: `Folder import: parsed ${selection.files.length} files locally. 0 file-content bytes uploaded. Later AI actions can send the derived diagram.`,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Repository import failed.');
    } finally {
      setLoading(false);
    }
  };

  const selectSource = (nextSource: ImportSource): void => {
    setSource(nextSource);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="repository-import-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Github size={20} className="text-primary" />
          <h2 id="repository-import-title" className="text-base font-semibold">
            Import Git repository
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8"
            onClick={onClose}
            aria-label="Close repository import"
            disabled={loading}
          >
            <X size={16} />
          </Button>
        </header>

        <div className="p-5">
          <div
            className="mb-5 grid grid-cols-2 rounded-md border border-border bg-background p-1"
            role="tablist"
            aria-label="Repository source"
          >
            <button
              type="button"
              role="tab"
              aria-selected={source === 'url'}
              onClick={() => selectSource('url')}
              className={cn(
                'flex h-9 items-center justify-center gap-2 rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                source === 'url'
                  ? 'bg-accent text-accent-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Link size={16} /> GitHub URL
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === 'folder'}
              onClick={() => selectSource('folder')}
              className={cn(
                'flex h-9 items-center justify-center gap-2 rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                source === 'folder'
                  ? 'bg-accent text-accent-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <FolderOpen size={16} /> Local folder
            </button>
          </div>

          {source === 'url' ? (
            <form onSubmit={(event) => void importUrl(event)}>
              <label htmlFor="github-repository-url" className="mb-2 block text-sm font-medium">
                GitHub repository URL
              </label>
              <input
                id="github-repository-url"
                type="url"
                autoFocus
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                disabled={loading}
              />
              <PrivacyNotice action="github" />
              <Button type="submit" className="mt-4 w-full" disabled={loading || !url.trim()}>
                <Github size={16} /> {loading ? 'Importing…' : 'Import repository'}
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Imported diagrams are a best-effort starting point — review and refine after import.
              </p>
            </form>
          ) : (
            <div>
              <p className="mb-3 text-xs text-muted-foreground">
                Your browser may say "upload" when selecting a folder. Selection only grants local
                read access; this action does not upload file contents.
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-24 w-full flex-col"
                onClick={() => folderRef.current?.click()}
                disabled={loading}
              >
                <FolderOpen size={24} />
                {loading ? 'Importing…' : 'Choose repository folder'}
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Only .bicep, .tf and candidate ARM JSON files are read, after you confirm below.
                Other file contents and dependency/build folders are ignored. Filename filtering is
                not secret detection.
              </p>
              <PrivacyNotice action="local" />
              {selection && (
                <div className="mt-3 text-xs">
                  <p role="status">
                    {selection.files.length} files selected ({selection.bytes.toLocaleString()}{' '}
                    bytes). {selection.ignored} ignored; {selection.limited} skipped by limits.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Limits: 500 files, 2 MB per file, 20 MB total. Candidate JSON files without ARM
                    resources produce no diagram nodes.
                  </p>
                  <ul
                    aria-label="Selected IaC files"
                    className="my-3 max-h-40 overflow-y-auto border-y border-border py-2"
                  >
                    {selection.files.map((file) => (
                      <li key={localPath(file)} className="break-all py-0.5">
                        {localPath(file)}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    disabled={loading || selection.files.length === 0}
                    onClick={() => void importFolder()}
                  >
                    <FolderOpen size={16} />{' '}
                    {loading ? 'Parsing locally...' : 'Parse selected files locally'}
                  </Button>
                  <p className="mt-2 text-muted-foreground">
                    0 file-content bytes uploaded. The resulting diagram may contain sensitive names
                    and properties; later AI actions can send it.
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <input
          ref={folderRef}
          type="file"
          // @ts-expect-error non-standard directory picker attributes
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) {
              setSelection(selectFolderFiles(Array.from(event.target.files)));
              setError(null);
            }
            event.target.value = '';
          }}
        />
      </section>
    </div>
  );
}
