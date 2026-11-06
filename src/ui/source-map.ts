import { normalize, type NormalizeMode } from '../core/algorithm';

/** UTF-16 range `[start, end)` in the text the user typed. */
export type Span = readonly [start: number, end: number];

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function* segments(text: string): Generator<{ segment: string; index: number }> {
  if (segmenter) {
    yield* segmenter.segment(text);
    return;
  }
  let index = 0;
  for (const segment of text) {
    yield { segment, index };
    index += segment.length;
  }
}

/**
 * For every code point of `normalize(input, mode)`, the range of `input` it came from.
 * Normalization works within a grapheme (NFC, case, stripped characters), so each grapheme
 * is normalized on its own. Returns null if that does not reproduce the whole-text result.
 */
export function sourceSpans(input: string, mode: NormalizeMode): Span[] | null {
  const spans: Span[] = [];
  let joined = '';
  for (const { segment, index } of segments(input)) {
    const part = normalize(segment, mode);
    joined += part;
    const span: Span = [index, index + segment.length];
    for (const _ of part) spans.push(span);
  }
  return joined === normalize(input, mode) ? spans : null;
}

/** Ranges of `input` covered by each chunk, or null when the input cannot be mapped. */
export function chunkSpans(
  input: string,
  mode: NormalizeMode,
  chunks: readonly { readonly start: number; readonly length: number }[],
): Span[] | null {
  const spans = sourceSpans(input, mode);
  if (!spans) return null;
  const result: Span[] = [];
  for (const { start, length } of chunks) {
    const first = spans[start];
    const last = spans[start + length - 1];
    if (!first || !last) return null;
    // A character that normalizes to several (ß → SS) may straddle two chunks; it stays in the first.
    const from = Math.max(first[0], result.at(-1)?.[1] ?? 0);
    result.push([from, Math.max(from, last[1])]);
  }
  return result;
}

/**
 * Index of the chunk the caret is in: the one holding the character just before it,
 * or the first chunk at the very start.
 */
export function chunkAtCaret(spans: readonly Span[], caret: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (spans[mid][0] < caret) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
