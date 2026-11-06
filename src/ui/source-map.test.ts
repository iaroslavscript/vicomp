import { describe, expect, it } from 'vitest';
import { chunkTokens, normalize, type NormalizeMode } from '../core/algorithm';
import { chunkAtCaret, chunkSpans, sourceSpans } from './source-map';

const pieces = (input: string, mode: NormalizeMode, size: number): string[] | null => {
  const chunks = chunkTokens(normalize(input, mode), size, { mode, date: null });
  return chunkSpans(input, mode, chunks)?.map(([a, b]) => input.slice(a, b)) ?? null;
};

describe('sourceSpans', () => {
  it('maps every normalized character back to the typed one', () => {
    const input = ' de89 3704\t\u200b0044 ';
    const spans = sourceSpans(input, 'ws-case');
    expect(spans?.map(([a, b]) => input.slice(a, b)).join('')).toBe('de8937040044');
  });

  it('keeps a decomposed letter together with its combining mark', () => {
    const input = 'e\u0301x';
    expect(normalize(input, 'ws')).toBe('éx');
    expect(sourceSpans(input, 'ws')).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });

  it('maps a character that grows when upper-cased to every resulting character', () => {
    expect(sourceSpans('aßb', 'ws-case')).toEqual([
      [0, 1],
      [1, 2],
      [1, 2],
      [2, 3],
    ]);
  });

  it('maps astral characters by code point in exact mode', () => {
    expect(sourceSpans('😀 x', 'none')).toEqual([
      [0, 2],
      [2, 3],
      [3, 4],
    ]);
  });
});

describe('chunkSpans', () => {
  it('covers the typed characters of each chunk, skipping what normalization removed', () => {
    expect(pieces('DE89 3704 0044 0532', 'ws-case', 4)).toEqual(['DE89', '3704', '0044', '0532']);
    expect(pieces('de-89/37 04', 'alnum', 3)).toEqual(['de-8', '9/37', '04']);
  });

  it('keeps a character split across chunks in the first one', () => {
    expect(pieces('aßb', 'ws-case', 2)).toEqual(['aß', 'b']);
  });
});

describe('chunkAtCaret', () => {
  const spans = [
    [0, 4],
    [5, 9],
    [10, 12],
  ] as const;

  it('picks the chunk holding the character before the caret', () => {
    expect([0, 1, 4, 5, 6, 9, 10, 11, 12].map((c) => chunkAtCaret(spans, c))).toEqual([0, 0, 0, 0, 1, 1, 1, 2, 2]);
  });
});
