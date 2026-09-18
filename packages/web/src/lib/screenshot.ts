// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Screenshot utility (DOM → PNG → Clipboard)
//
// Uses html2canvas to render a DOM node as PNG canvas, then copies to
// clipboard via the Clipboard API. Desktop only.
//
// html2canvas directly rasterises CSS → Canvas (no SVG foreignObject),
// so it handles complex HTML (markdown, code blocks, nested styles)
// much better than html-to-image which chokes on complex content.
// ═══════════════════════════════════════════════════════════════════════════

// @ts-ignore — html2canvas .d.ts has compat issues with tsconfig strict
import html2canvas from 'html2canvas';

/**
 * Render HTML string to a PNG blob, copy to clipboard.
 *
 * Creates a temporary on-screen container (z-index: -1, behind main UI),
 * renders the HTML, captures with html2canvas, then cleans up.
 */
export async function screenshotHtmlToClipboard(
  html: string,
  options?: {
    width?: number;
    backgroundColor?: string;
    fontFamily?: string;
    fontSize?: string;
  },
): Promise<void> {
  const width = options?.width ?? 900;
  const bgColor = options?.backgroundColor ?? '#1E1E1E';
  const fontFamily = options?.fontFamily
    ?? "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'SF Mono', monospace";
  const fontSize = options?.fontSize ?? '13px';

  // Create container — on-screen at z-index:-1 so browser fully renders it
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    z-index: -1;
    pointer-events: none;
    width: ${width}px;
    overflow: hidden;
    font-family: ${fontFamily};
    font-size: ${fontSize};
    line-height: 1.4;
    background-color: ${bgColor};
    color: #E5E5E5;
    padding: 8px;
  `;
  container.innerHTML = html;
  document.body.appendChild(container);

  // Wait for browser to layout
  await new Promise(resolve => setTimeout(resolve, 150));

  try {
    const scale = window.devicePixelRatio ?? 1;
    const canvas = await html2canvas(container, {
      scale,
      backgroundColor: bgColor,
      width: container.scrollWidth,
      height: container.scrollHeight,
      useCORS: true,
      logging: false,
    });

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });

    if (!blob) {
      throw new Error('Failed to generate screenshot blob');
    }

    const clipboardItem = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([clipboardItem]);
  } finally {
    document.body.removeChild(container);
  }
}
