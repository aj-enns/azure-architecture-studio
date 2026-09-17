import { isScannableIacPath, scanRepoFiles, type Diagram } from '@aas/shared';

export interface LocalFile {
  name: string;
  webkitRelativePath?: string;
  size: number;
  text: () => Promise<string>;
}

export interface FolderSelection {
  name: string;
  files: LocalFile[];
  ignored: number;
  limited: number;
  bytes: number;
}

export function localPath(file: LocalFile): string {
  return file.webkitRelativePath || file.name;
}

export function selectFolderFiles(selected: LocalFile[]): FolderSelection {
  const selection: FolderSelection = {
    name: selected[0] ? localPath(selected[0]).split('/')[0]! : 'Imported repository',
    files: [],
    ignored: 0,
    limited: 0,
    bytes: 0,
  };
  for (const file of selected) {
    const path = localPath(file);
    if (
      /(^|\/)(\.git|node_modules|\.terraform|\.venv|dist|build|bin|obj)(\/|$)/i.test(path) ||
      !isScannableIacPath(path)
    ) {
      selection.ignored++;
    } else if (
      file.size > 2_000_000 ||
      selection.files.length >= 500 ||
      selection.bytes + file.size > 20_000_000
    ) {
      selection.limited++;
    } else {
      selection.files.push(file);
      selection.bytes += file.size;
    }
  }
  return selection;
}

export async function parseLocalFolder(selection: FolderSelection): Promise<Diagram> {
  const files = [];
  for (const file of selection.files) {
    files.push({ path: localPath(file), content: await file.text() });
  }
  const diagram = scanRepoFiles(files, selection.name);
  if (diagram.nodes.length === 0)
    throw new Error('No supported Azure resources were found in the selected files.');
  return diagram;
}
