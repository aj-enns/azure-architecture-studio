import { toPng, toSvg } from 'html-to-image';

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** The React Flow viewport element holds the rendered graph. */
function getViewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.react-flow__viewport');
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
}

/** Background color matched to the current theme so exports look correct. */
function backgroundColor(): string {
  return document.documentElement.classList.contains('dark') ? '#0b0f19' : '#ffffff';
}

export async function exportPng(name: string): Promise<void> {
  const viewport = getViewport();
  if (!viewport) return;
  const dataUrl = await toPng(viewport, { backgroundColor: backgroundColor(), pixelRatio: 2, cacheBust: true });
  triggerDownload(dataUrl, `${slugify(name)}.png`);
}

export async function exportSvg(name: string): Promise<void> {
  const viewport = getViewport();
  if (!viewport) return;
  const dataUrl = await toSvg(viewport, { backgroundColor: backgroundColor(), cacheBust: true });
  triggerDownload(dataUrl, `${slugify(name)}.svg`);
}

export function downloadJson(name: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${slugify(name)}.json`);
  URL.revokeObjectURL(url);
}

export function downloadCsv(name: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${slugify(name)}.csv`);
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}
