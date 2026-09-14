import { toSvg } from 'html-to-image';

const EXPORT_PADDING = 64;
const PNG_PIXEL_RATIO = 2;
const SVG_DATA_PREFIX = 'data:image/svg+xml;charset=utf-8,';

interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ExportLayout {
  width: number;
  height: number;
  transform: string;
}

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
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'diagram'
  );
}

/** Background color matched to the current theme so exports look correct. */
function backgroundColor(): string {
  return document.documentElement.classList.contains('dark') ? '#0b0f19' : '#ffffff';
}

/** Fit all rendered nodes into an export surface independent of the live pan/zoom. */
export function calculateExportLayout(
  viewportRect: RectLike,
  nodeRects: RectLike[],
  zoom: number,
  padding = EXPORT_PADDING,
): ExportLayout | null {
  const visibleRects = nodeRects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (visibleRects.length === 0 || !Number.isFinite(zoom) || zoom <= 0) return null;

  const minX = Math.min(...visibleRects.map((rect) => (rect.left - viewportRect.left) / zoom));
  const minY = Math.min(...visibleRects.map((rect) => (rect.top - viewportRect.top) / zoom));
  const maxX = Math.max(...visibleRects.map((rect) => (rect.right - viewportRect.left) / zoom));
  const maxY = Math.max(...visibleRects.map((rect) => (rect.bottom - viewportRect.top) / zoom));
  const width = Math.ceil(maxX - minX + padding * 2);
  const height = Math.ceil(maxY - minY + padding * 2);

  return {
    width,
    height,
    transform: `translate(${padding - minX}px, ${padding - minY}px) scale(1)`,
  };
}

function getExportLayout(viewport: HTMLElement): ExportLayout | null {
  const transform = getComputedStyle(viewport).transform;
  const zoom = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
  const nodeRects = [...viewport.querySelectorAll<HTMLElement>('.react-flow__node')]
    .filter((node) => getComputedStyle(node).visibility !== 'hidden')
    .map((node) => node.getBoundingClientRect());
  return calculateExportLayout(viewport.getBoundingClientRect(), nodeRects, zoom);
}

/** Transform applied to the html-to-image clone so the full diagram is framed. */
function exportStyle(layout: ExportLayout): Partial<CSSStyleDeclaration> {
  return {
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    transform: layout.transform,
    transformOrigin: 'top left',
  };
}

/**
 * Connector labels render as HTML (via React Flow's `EdgeLabelRenderer`), so
 * html-to-image inlines their computed styles automatically — just like the node
 * cards — and they export readably without any restyling. A full-coverage
 * background `<rect>` is still injected because html-to-image only paints the
 * background on the transformed viewport element, leaving the SVG's padding
 * strips transparent (white bands in dark mode).
 */
function withExportBackground(svgDataUrl: string): string {
  const background = `<rect x="0" y="0" width="100%" height="100%" fill="${backgroundColor()}"/>`;
  const markup = decodeURIComponent(
    svgDataUrl.startsWith(SVG_DATA_PREFIX) ? svgDataUrl.slice(SVG_DATA_PREFIX.length) : svgDataUrl,
  );
  const withBackground = markup.replace(/<svg\b[^>]*>/, (open) => `${open}${background}`);
  return `${SVG_DATA_PREFIX}${encodeURIComponent(withBackground)}`;
}

/** Rasterize the (label-corrected) SVG to a PNG data URL at 2x density. */
async function rasterizeSvg(svgDataUrl: string, layout: ExportLayout): Promise<string> {
  const image = new Image();
  image.src = svgDataUrl;
  await image.decode();
  // A macrotask lets Chromium paint the SVG's foreignObject nodes before we draw.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const canvas = document.createElement('canvas');
  canvas.width = layout.width * PNG_PIXEL_RATIO;
  canvas.height = layout.height * PNG_PIXEL_RATIO;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG export is not supported by this browser.');
  context.fillStyle = backgroundColor();
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** Capture the live React Flow viewport as an SVG framed to the full diagram. */
async function captureSvg(viewport: HTMLElement, layout: ExportLayout): Promise<string> {
  const dataUrl = await toSvg(viewport, {
    backgroundColor: backgroundColor(),
    width: layout.width,
    height: layout.height,
    cacheBust: true,
    skipFonts: true,
    style: exportStyle(layout),
  });
  return withExportBackground(dataUrl);
}

export async function exportPng(name: string): Promise<void> {
  const viewport = getViewport();
  if (!viewport) return;
  const layout = getExportLayout(viewport);
  if (!layout) return;

  const svgDataUrl = await captureSvg(viewport, layout);
  const pngDataUrl = await rasterizeSvg(svgDataUrl, layout);
  triggerDownload(pngDataUrl, `${slugify(name)}.png`);
}

export async function exportSvg(name: string): Promise<void> {
  const viewport = getViewport();
  if (!viewport) return;
  const layout = getExportLayout(viewport);
  if (!layout) return;

  const svgDataUrl = await captureSvg(viewport, layout);
  triggerDownload(svgDataUrl, `${slugify(name)}.svg`);
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
