import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLocalFolder, selectFolderFiles, type LocalFile } from './folderImport.js';

function file(path: string, size = 100): LocalFile {
  return {
    name: path.split('/').at(-1)!,
    webkitRelativePath: path,
    size,
    text: vi
      .fn()
      .mockResolvedValue(
        "resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = { name: 'teststorage' }",
      ),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('local folder import', () => {
  it('previews metadata without reading contents, then parses only IaC with no network', async () => {
    const files = [
      file('repo/infra/main.bicep'),
      file('repo/.env'),
      file('repo/src/app.ts'),
      file('repo/node_modules/module/template.json'),
      file('repo/.terraform/main.tf'),
    ];
    const network = vi.fn(() => {
      throw new Error('Network forbidden');
    });
    vi.stubGlobal('fetch', network);
    const selection = selectFolderFiles(files);
    expect(selection.files).toHaveLength(1);
    expect(selection.ignored).toBe(4);
    for (const candidate of files) expect(candidate.text).not.toHaveBeenCalled();
    const diagram = await parseLocalFolder(selection);
    expect(diagram.nodes).toHaveLength(1);
    for (const candidate of files.slice(1)) expect(candidate.text).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('reports size, total-byte and count limits without silent truncation', () => {
    const selection = selectFolderFiles([
      file('repo/large.bicep', 2_000_001),
      ...Array.from({ length: 11 }, (_, index) => file(`repo/${index}.bicep`, 2_000_000)),
    ]);
    expect(selection.files).toHaveLength(10);
    expect(selection.limited).toBe(2);
    const count = selectFolderFiles(
      Array.from({ length: 501 }, (_, index) => file(`repo/${index}.tf`)),
    );
    expect(count.files).toHaveLength(500);
    expect(count.limited).toBe(1);
  });

  it('does not replace the diagram with an empty import', async () => {
    await expect(parseLocalFolder(selectFolderFiles([]))).rejects.toThrow(
      'No supported Azure resources',
    );
  });
});
