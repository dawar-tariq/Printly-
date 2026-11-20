import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import type { Font, GlyphRun } from 'fontkit';
import bidiFactory from 'bidi-js';

export type FontFamily = 'Noto Sans' | 'Noto Sans Arabic' | 'Noto Sans Devanagari';
export type Weight = 'regular' | 'bold';
type FontAsset = { family: FontFamily; weight: Weight; path: string; bytes: Buffer; font: Font };

const dir = join(process.cwd(), 'src', 'assets', 'standee-fonts');
// Fonts are bundled with the application; rendering never fetches them over the network.
const specs: Array<{ family: FontFamily; weight: Weight; file: string }> = [
  { family: 'Noto Sans', weight: 'regular', file: 'NotoSans-Regular.ttf' },
  { family: 'Noto Sans', weight: 'bold', file: 'NotoSans-Bold.ttf' },
  { family: 'Noto Sans Arabic', weight: 'regular', file: 'NotoSansArabic-Regular.ttf' },
  { family: 'Noto Sans Arabic', weight: 'bold', file: 'NotoSansArabic-Bold.ttf' },
  { family: 'Noto Sans Devanagari', weight: 'regular', file: 'NotoSansDevanagari-Regular.ttf' },
  { family: 'Noto Sans Devanagari', weight: 'bold', file: 'NotoSansDevanagari-Bold.ttf' },
];

let cached: FontAsset[] | null = null;
export function standeeFonts(): FontAsset[] {
  if (!cached) {
    cached = specs.map(({ family, weight, file }) => {
      const path = join(dir, file);
      const bytes = readFileSync(path);
      return { family, weight, path, bytes, font: fontkit.create(bytes) as Font };
    });
  }
  return cached;
}

export class StandeeTextError extends Error {}

/** Remove control characters that could change the layout or the apparent name. */
export function cleanStandeeName(value: string): string {
  return value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

type ShapedRun = { font: Font; layout: GlyphRun };
const bidi = bidiFactory();

/**
 * Shape real names with the bundled fonts. Names are drawn as glyph outlines in
 * the SVG: PDF and raster renderers then agree on complex-script shaping,
 * combining marks and bidi ordering. The template's labels remain embedded text.
 * Reject unsupported characters rather than quietly printing missing-glyph boxes.
 */
export function shapeName(value: string, weight: Weight): ShapedRun[] {
  const available = standeeFonts().filter((asset) => asset.weight === weight);
  const embedding = bidi.getEmbeddingLevels(value);
  const logicalRuns: Array<{ font: Font; family: FontFamily; level: number; text: string }> = [];
  const indexToRun: number[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  for (const { segment, index } of segmenter.segment(value)) {
    const level = embedding.levels[index] ?? 0;
    const cps = Array.from(segment, (character) => character.codePointAt(0)!);
    const matches = available.filter(({ font }) => cps.every((cp) => font.hasGlyphForCodePoint(cp)));
    const preferred = /\p{Script=Arabic}/u.test(segment) || (level % 2 === 1)
      ? 'Noto Sans Arabic'
      : /\p{Script=Devanagari}/u.test(segment) ? 'Noto Sans Devanagari' : 'Noto Sans';
    const previous = logicalRuns[logicalRuns.length - 1];
    const chosen = matches.find(({ family }) => family === preferred)
      ?? (previous?.level === level ? matches.find(({ family }) => family === previous.family) : undefined)
      ?? matches[0];
    if (!chosen) throw new StandeeTextError('The saved shop or owner name contains characters this print template cannot render. Please use supported letters or contact support.');

    // In RTL segments, mirrored punctuation is laid out using its paired glyph.
    const shapedText = level % 2 === 1
      ? Array.from(segment, (character) => bidi.getMirroredCharacter(character) ?? character).join('')
      : segment;
    let runIndex = logicalRuns.length - 1;
    if (previous && previous.family === chosen.family && previous.level === level) previous.text += shapedText;
    else {
      logicalRuns.push({ font: chosen.font, family: chosen.family, level, text: shapedText });
      runIndex = logicalRuns.length - 1;
    }
    for (let i = index; i < index + segment.length; i++) indexToRun[i] = runIndex;
  }

  // The bidi algorithm reorders runs; fontkit shapes and orders glyphs within
  // each run according to its direction (including zero-advance marks).
  const seen = new Set<number>();
  const visualRuns: ShapedRun[] = [];
  for (const index of bidi.getReorderedIndices(value, embedding)) {
    const runIndex = indexToRun[index];
    if (runIndex === undefined || seen.has(runIndex)) continue;
    seen.add(runIndex);
    const run = logicalRuns[runIndex];
    const layout = run.font.layout(run.text, undefined, undefined, undefined, run.level % 2 ? 'rtl' : 'ltr');
    if (layout.glyphs.some((glyph) => glyph.id === 0)) {
      throw new StandeeTextError('The saved shop or owner name contains characters this print template cannot render. Please use supported letters or contact support.');
    }
    visualRuns.push({ font: run.font, layout });
  }
  return visualRuns;
}

export function textWidth(value: string, weight: Weight, size: number): number {
  return shapeName(value, weight).reduce((total, run) => total + run.layout.advanceWidth / run.font.unitsPerEm * size, 0);
}

/** SVG paths use the font's own outlines, positioned with fontkit's shaping offsets. */
export function namePaths(value: string, x: number, y: number, size: number, weight: Weight, fill: string): string {
  let cursor = x;
  const paths: string[] = [];
  const num = (v: number) => Number(v.toFixed(5));
  for (const { font, layout } of shapeName(value, weight)) {
    const scale = size / font.unitsPerEm;
    for (let i = 0; i < layout.glyphs.length; i++) {
      const glyph = layout.glyphs[i];
      const pos = layout.positions[i];
      const path = glyph.path.toSVG();
      if (path) {
        const gx = cursor + pos.xOffset * scale;
        const gy = y - pos.yOffset * scale;
        paths.push(`<path d="${path}" transform="translate(${num(gx)} ${num(gy)}) scale(${num(scale)} ${num(-scale)})"/>`);
      }
      cursor += pos.xAdvance * scale;
    }
  }
  return `<g fill="${fill}">${paths.join('')}</g>`;
}
