import type { NormalizeMode } from '../core/algorithm';

export const NORMALIZE_MODES: ReadonlyArray<{ mode: NormalizeMode; label: string }> = [
  { mode: 'ws-case', label: 'Ignore spaces & case' },
  { mode: 'alnum', label: 'Letters & digits only, ignore case' },
  { mode: 'ws', label: 'Ignore spaces only' },
  { mode: 'none', label: 'Exact text' },
];

export const isNormalizeMode = (v: unknown): v is NormalizeMode =>
  NORMALIZE_MODES.some((m) => m.mode === v);

export const CHUNK_SIZES = [2, 3, 4, 5, 6, 8, 10] as const;
export const DEFAULT_CHUNK_SIZE = 4;
