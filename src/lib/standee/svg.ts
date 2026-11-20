import 'server-only';
import QRCode from 'qrcode';
import { STANDEE_THEMES, type StandeeInfo, type StandeeTheme } from './shared';
import { cleanStandeeName, namePaths, shapeName, StandeeTextError, textWidth, type Weight } from './fonts';

// All artwork is laid out in millimetres inside an A4 page. The white 5.5 mm
// outer margin protects the design from normal non-printable printer edges.
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const QR_BOX = { x: 46, y: 95, size: 118, quietModules: 4 } as const;

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const n = (value: number) => Number(value.toFixed(4)).toString();

function text(value: string, x: number, y: number, size: number, weight: Weight, fill: string, anchor: 'start' | 'middle' | 'end' = 'start') {
  return `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" font-weight="${weight === 'bold' ? '700' : '400'}" fill="${fill}" text-anchor="${anchor}" xml:space="preserve" font-family="Noto Sans">${esc(value)}</text>`;
}

/** Wrap by words, then by grapheme for very long unbroken names. Never clip names. */
function linesAtSize(value: string, weight: Weight, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const word of value.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, weight, size) <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    if (textWidth(word, weight, size) <= maxWidth) { line = word; continue; }
    for (const { segment } of segmenter.segment(word)) {
      const next = line + segment;
      if (line && textWidth(next, weight, size) > maxWidth) { lines.push(line); line = segment; }
      else line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitName(value: string, weight: Weight, maxWidth: number, maxLines: number, start: number, min: number) {
  const name = cleanStandeeName(value);
  if (!name) throw new StandeeTextError('Please add a valid shop and owner name before creating a standee.');
  if (Array.from(name).length > 160) throw new StandeeTextError('The saved shop or owner name is too long to fit on the standee. Please shorten it and try again.');
  // Ensure unsupported characters fail clearly rather than rendering as missing-glyph boxes.
  shapeName(name, weight);
  for (let size = start; size >= min - 0.001; size -= 0.2) {
    const lines = linesAtSize(name, weight, size, maxWidth);
    if (lines.length <= maxLines) return { lines, size };
  }
  throw new StandeeTextError('The saved shop or owner name is too long to fit on the standee. Please shorten it and try again.');
}

function qrPath(url: string) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const { size } = qr.modules;
  const get = (row: number, col: number) => qr.modules.get(row, col);
  const unit = QR_BOX.size / (size + QR_BOX.quietModules * 2);
  let path = '';
  // Coalesce adjacent black modules into rectangles to keep the vector PDF small.
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size;) {
      if (!get(row, col)) { col++; continue; }
      const start = col;
      while (col < size && get(row, col)) col++;
      const x = QR_BOX.x + (start + QR_BOX.quietModules) * unit;
      const y = QR_BOX.y + (row + QR_BOX.quietModules) * unit;
      path += `M${n(x)} ${n(y)}h${n((col - start) * unit)}v${n(unit)}h-${n((col - start) * unit)}z`;
    }
  }
  return path;
}

const icon = (kind: 'scan' | 'service' | 'upload' | 'card' | 'store' | 'shield' | 'printer', x: number, y: number, size: number, color: string, stroke = 1.7) => {
  const d: Record<typeof kind, string> = {
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16M8 8h2M14 8h2M8 16h2M14 16h2"/>',
    service: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    upload: '<path d="M7 18H6a4 4 0 0 1-.6-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9h-1M12 20V10M8.5 13.5 12 10l3.5 3.5"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/>',
    store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.5 8.1-8 10-4.5-1.9-8-5-8-10V6l8-3ZM8.5 12l2.3 2.3 4.7-4.8"/>',
    printer: '<path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 13h10v8H7zM17.5 10.5h.01M9 16h6"/>',
  };
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(size / 24)})" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${d[kind]}</g>`;
};

/** A single SVG is the source of truth for the preview, vector PDF and 300-dpi PNG. */
export function standeeSvg(info: StandeeInfo, theme: StandeeTheme): string {
  const colors = STANDEE_THEMES[theme];
  const ink = '#161616';
  const gray = '#4b4b4b';
  const shop = fitName(info.shop_name, 'bold', 126, 2, 5.9, 3.1);
  const owner = fitName(`Owner: ${info.owner_name}`, 'regular', 126, 2, 3.8, 2.7);
  const shopY = shop.lines.length === 1 ? 61.4 : 58.9;
  const shopText = shop.lines.map((line, i) => namePaths(line, 53, shopY + i * 5.8, shop.size, 'bold', ink)).join('');
  const ownerY = shop.lines.length === 1 ? 70.1 : 70.2;
  const ownerText = owner.lines.map((line, i) => namePaths(line, 53, ownerY + i * 4, owner.size, 'regular', gray)).join('');
  const qr = qrPath(info.order_url);
  const logoX = (210 - (9.4 + 1.8 + textWidth('Printly', 'bold', 8.8))) / 2;
  const bannerText = 'Fast • Secure • Hassle-Free';
  const bannerX = (210 - (5.5 + 3 + textWidth(bannerText, 'bold', 3.2))) / 2;

  const columns = [31.5, 80.5, 129.5, 178.5];
  const steps = [
    { icon: 'scan' as const, line1: '1. Scan this', line2: 'QR code', help1: 'Open your camera', help2: 'and scan the code.' },
    { icon: 'service' as const, line1: '2. Select service', line2: 'type', help1: 'Choose the service', help2: 'you need.' },
    { icon: 'upload' as const, line1: '3. Upload your', line2: 'files', help1: 'Upload documents', help2: 'or images.' },
    { icon: 'card' as const, line1: '4. Pay & collect', line2: 'your prints', help1: 'Complete payment', help2: 'and collect.' },
  ];
  const instructions = steps.map((step, i) => {
    const x = columns[i];
    return `<rect x="${n(x - 5.2)}" y="249.6" width="10.4" height="10.4" rx="2.4" fill="${colors.peach}"/>${icon(step.icon, x - 3.6, 251.3, 7.2, colors.accent, 1.8)}
      ${text(step.line1, x, 264.1, 3.15, 'bold', ink, 'middle')}${text(step.line2, x, 267.7, 3.15, 'bold', ink, 'middle')}
      ${text(step.help1, x, 271.9, 2.85, 'regular', gray, 'middle')}${text(step.help2, x, 275.2, 2.85, 'regular', gray, 'middle')}`;
  }).join('');
  const chevrons = [56, 105, 154].map((x) => `<path d="M${x - 1} 253l2 2-2 2" fill="none" stroke="${colors.accent}" stroke-width="0.65" stroke-linecap="round" stroke-linejoin="round"/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">
    <rect width="210" height="297" fill="#ffffff"/>
    <rect x="5.5" y="5.5" width="199" height="286" rx="5" fill="${colors.cream}" stroke="${colors.border}" stroke-width="0.6"/>
    <rect x="${n(logoX)}" y="13.3" width="9.4" height="9.4" rx="2.5" fill="${colors.accent}"/>
    ${icon('printer', logoX + 1.3, 14.6, 6.8, '#ffffff', 2)}
    ${text('Printly', logoX + 11.2, 21.3, 8.8, 'bold', ink)}
    <text x="105" y="28.7" font-family="Noto Sans" font-size="3.4" text-anchor="middle" fill="${gray}" xml:space="preserve">Print <tspan fill="${colors.accent}">•</tspan> Upload <tspan fill="${colors.accent}">•</tspan> Pay <tspan fill="${colors.accent}">•</tspan> Collect</text>
    <text x="105" y="44.5" font-family="Noto Sans" font-size="10.2" font-weight="700" text-anchor="middle" fill="${ink}"><tspan>Scan to </tspan><tspan fill="${colors.accent}">Print</tspan></text>
    <rect x="21" y="51.5" width="168" height="27" rx="6.5" fill="${colors.peach}"/>
    ${icon('store', 30, 57.6, 14.2, colors.accent, 1.65)}
    <line x1="48.6" y1="57.8" x2="48.6" y2="72.3" stroke="${colors.accent}" stroke-width="0.45"/>
    ${shopText}${ownerText}
    <rect x="35" y="84" width="140" height="140" rx="7" fill="#ffffff" stroke="#eadfd7" stroke-width="0.4"/>
    <path d="M41 99v-5a4 4 0 0 1 4-4h5 M160 90h5a4 4 0 0 1 4 4v5 M41 209v5a4 4 0 0 0 4 4h5 M160 218h5a4 4 0 0 0 4-4v-5" fill="none" stroke="${colors.accent}" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="${QR_BOX.x}" y="${QR_BOX.y}" width="${QR_BOX.size}" height="${QR_BOX.size}" fill="#ffffff"/>
    <path d="${qr}" fill="#000000" shape-rendering="crispEdges"/>
    <rect x="70" y="227" width="70" height="10" rx="5" fill="${colors.accent}"/>
    ${text('SCAN ME', 105, 234.15, 4.6, 'bold', '#ffffff', 'middle')}
    <path d="M22 244h30 M158 244h30" fill="none" stroke="${colors.border}" stroke-width="0.5"/>
    ${text('How to Print with Printly', 105, 245.6, 4.2, 'bold', ink, 'middle')}
    ${instructions}${chevrons}
    <rect x="44" y="280" width="122" height="8.5" rx="4.25" fill="${colors.peach}"/>
    ${icon('shield', bannerX, 281.5, 5.5, colors.accent, 1.8)}
    <text x="${n(bannerX + 8.5)}" y="285.6" font-family="Noto Sans" font-size="3.2" font-weight="700" fill="${ink}" xml:space="preserve">Fast <tspan fill="${colors.accent}">•</tspan> Secure <tspan fill="${colors.accent}">•</tspan> Hassle-Free</text>
  </svg>`;
}
