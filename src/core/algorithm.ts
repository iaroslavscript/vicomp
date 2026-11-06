// The complete Vicomp algorithm: everything that decides the output for a given input.
// It may only import the data tables in src/data/. scripts/algorithm-hash.ts hashes this
// file and those tables at build time; the build fails unless src/core/version.ts maps
// that hash to a version. Keep UI-only code out of here.

import { CITIES_RAW } from '../data/cities';
import { COUNTRIES } from '../data/countries';
import { COLORS, SYMBOLS, TRANSPORT_BANDS, type Color, type Glyph, type Transport } from '../data/glyphs';
import { WORDS_RAW } from '../data/words';

export type { Color, Glyph, Transport };

// ---- SHA-256 -------------------------------------------------------------------------------

// Synchronous SHA-256 (FIPS 180-4). Used instead of WebCrypto so fingerprints are
// available synchronously and also on non-secure origins (e.g. http://LAN-IP).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export function sha256(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLength);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// ---- Normalization -------------------------------------------------------------------------

export type NormalizeMode = 'ws-case' | 'ws' | 'alnum' | 'none';

/**
 * Explicit description of what each mode does, mixed into every digest so that two
 * computers only show matching results when they compared with the same rules.
 */
export const NORMALIZE_PARAMS: Readonly<Record<NormalizeMode, string>> = {
  'ws-case': 'nfc,strip-invisible,strip-whitespace,ignore-case',
  alnum: 'nfc,strip-invisible,letters-digits-only,ignore-case',
  ws: 'nfc,strip-invisible,strip-whitespace',
  none: 'exact',
};

// Invisible characters that sneak in with copy & paste.
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/gu;
const WHITESPACE = /\s/gu;
const NOT_ALNUM = /[^\p{L}\p{N}]/gu;

export function normalize(input: string, mode: NormalizeMode): string {
  if (mode === 'none') return input;
  const text = input.normalize('NFC').replace(INVISIBLE, '');
  switch (mode) {
    case 'ws':
      return text.replace(WHITESPACE, '');
    case 'ws-case':
      return text.replace(WHITESPACE, '').toUpperCase();
    case 'alnum':
      return text.replace(NOT_ALNUM, '').toUpperCase();
  }
}

// ---- Hash context --------------------------------------------------------------------------

/** Everything besides the value itself that is mixed into the digests. */
export interface HashContext {
  readonly mode: NormalizeMode;
  /** UTC calendar date (YYYY-MM-DD) when the daily salt is enabled, otherwise null. */
  readonly date: string | null;
}

// Frozen domain-separation tag. It is not the displayed version (see version.ts);
// changing it changes every output.
const HEADER_TAG = 'vicomp/v2';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Current calendar date in UTC, without time, e.g. "2026-10-30". */
export const utcDate = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/**
 * Fixed-field header put in front of the value. The value always comes last, so it can
 * never be confused with metadata.
 */
export function contextHeader(domain: string, context: HashContext): string {
  if (context.date !== null && !DATE.test(context.date)) throw new RangeError(`bad date: ${context.date}`);
  return [
    `${HEADER_TAG}/${domain}`,
    `normalize=${NORMALIZE_PARAMS[context.mode]}`,
    `date=${context.date ?? 'none'}`,
    '',
  ].join('\u0000');
}

// ---- Digests -------------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Domain-separated digest, so every view draws independent bits from the input.
 * The context (normalization rules, optional date) is mixed in as well.
 */
export function digest(domain: string, context: HashContext, text: string): Uint8Array {
  return sha256(encoder.encode(contextHeader(domain, context) + text));
}

/** Reads unsigned integers MSB-first from a byte array. */
export class BitReader {
  private position = 0;

  constructor(private readonly bytes: Uint8Array) {}

  read(bits: number): number {
    if (bits < 1 || bits > 24) throw new RangeError(`bits must be 1..24, got ${bits}`);
    if (this.position + bits > this.bytes.length * 8) throw new RangeError('out of bits');
    let value = 0;
    for (let i = 0; i < bits; i++) {
      const p = this.position + i;
      value = (value << 1) | ((this.bytes[p >> 3] >> (7 - (p & 7))) & 1);
    }
    this.position += bits;
    return value;
  }
}

// ---- Cities --------------------------------------------------------------------------------

export interface City {
  readonly index: number;
  readonly name: string;
  readonly countryCode: string;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  /** Integer unit-sphere coordinates scaled by 1e5 (exact, engine-independent math). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const CITIES: readonly City[] = CITIES_RAW.split('\n').map((line, index) => {
  const [name, countryCode, lat, lon, x, y, z] = line.split('|');
  return {
    index,
    name,
    countryCode,
    country: COUNTRIES[countryCode] ?? countryCode,
    lat: Number(lat),
    lon: Number(lon),
    x: Number(x),
    y: Number(y),
    z: Number(z),
  };
});

/** Squared chord distance in integer units; exact, so ordering is identical everywhere. */
export function chord2(a: City, b: City): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Great-circle distance in km; display only. */
export function distanceKm(a: City, b: City): number {
  const chord = Math.sqrt(chord2(a, b)) / 1e5;
  return 2 * 6371 * Math.asin(Math.min(1, chord / 2));
}

/** The `count` nearest cities to `from` that are not in `exclude`, nearest first. */
export function nearest(from: City, count: number, exclude: ReadonlySet<number>): City[] {
  // Single pass keeping the best `count` sorted by (distance, index); ties resolve by index.
  const best: { c: City; d: number }[] = [];
  for (const c of CITIES) {
    if (exclude.has(c.index)) continue;
    const d = chord2(from, c);
    if (best.length === count && d >= best[count - 1].d) continue;
    let i = best.length;
    while (i > 0 && best[i - 1].d > d) i--;
    best.splice(i, 0, { c, d });
    if (best.length > count) best.pop();
  }
  return best.map(({ c }) => c);
}

// ---- Travel story --------------------------------------------------------------------------

// Squared chord distances (see chord2) for 150 km and 800 km.
export const SHORT_LIMIT = 5_543_030;
export const MEDIUM_LIMIT = 157_468_627;

export const STORY_LEGS = 6;
export const START_BITS = 11; // 2048 cities
export const NEXT_BITS = 5; // one of the 32 nearest unvisited cities
export const TRANSPORT_BITS = 3;
export const STORY_BITS = START_BITS + STORY_LEGS * (NEXT_BITS + TRANSPORT_BITS);

export interface Leg {
  readonly from: City;
  readonly to: City;
  readonly transport: Transport;
  readonly km: number;
  readonly crossesBorder: boolean;
}

export interface Story {
  readonly start: City;
  readonly legs: readonly Leg[];
  readonly totalKm: number;
  /** One-line human readable story. */
  readonly text: string;
}

export function makeStory(text: string, context: HashContext): Story {
  if (CITIES.length !== 1 << START_BITS) throw new Error('city table size mismatch');
  const bits = new BitReader(digest('story', context, text));
  const start = CITIES[bits.read(START_BITS)];
  const visited = new Set([start.index]);
  const legs: Leg[] = [];
  let current = start;
  for (let i = 0; i < STORY_LEGS; i++) {
    const options = nearest(current, 1 << NEXT_BITS, visited);
    const next = options[bits.read(NEXT_BITS)];
    const d2 = chord2(current, next);
    const band = d2 < SHORT_LIMIT ? 0 : d2 < MEDIUM_LIMIT ? 1 : 2;
    legs.push({
      from: current,
      to: next,
      transport: TRANSPORT_BANDS[band][bits.read(TRANSPORT_BITS)],
      km: distanceKm(current, next),
      crossesBorder: next.countryCode !== current.countryCode,
    });
    visited.add(next.index);
    current = next;
  }
  return { start, legs, totalKm: legs.reduce((sum, l) => sum + l.km, 0), text: storyText(start, legs) };
}

function storyText(start: City, legs: readonly Leg[]): string {
  const parts = legs.map((leg, i) => {
    const border = leg.crossesBorder ? ` (${leg.to.country})` : '';
    const lead = i === 0 ? '' : i === legs.length - 1 ? ' and finally ' : ', then ';
    return `${lead}${leg.transport.emoji} ${leg.transport.phrase} to ${leg.to.name}${border}`;
  });
  return `From ${start.name} (${start.country}) ${parts.join('')}.`;
}

// ---- Words & emoji -------------------------------------------------------------------------

export const WORDS: readonly string[] = WORDS_RAW.split(' ');

export interface Tile {
  readonly symbol: Glyph;
  readonly color: Color;
}

export const SYMBOL_BITS = 6;
export const COLOR_BITS = 3;
export const WORD_BITS = 11;
export const WORD_COUNT = 5;
export const TILE_COUNT = 8;

export function wordCode(text: string, context: HashContext): string[] {
  const bits = new BitReader(digest('words', context, text));
  return Array.from({ length: WORD_COUNT }, () => WORDS[bits.read(WORD_BITS)]);
}

const readTile = (bits: BitReader): Tile => ({
  symbol: SYMBOLS[bits.read(SYMBOL_BITS)],
  color: COLORS[bits.read(COLOR_BITS)],
});

export function emojiStrip(text: string, context: HashContext): Tile[] {
  const bits = new BitReader(digest('emoji', context, text));
  return Array.from({ length: TILE_COUNT }, () => readTile(bits));
}

export interface ChunkToken extends Tile {
  readonly index: number;
  readonly start: number;
  readonly length: number;
  readonly word: string;
}

/**
 * Per-chunk tokens to locate *where* two inputs differ. Chunks are split by code
 * point, and the position is hashed in, so moved chunks look different too.
 */
export function chunkTokens(text: string, size: number, context: HashContext): ChunkToken[] {
  const chars = Array.from(text);
  const tokens: ChunkToken[] = [];
  for (let start = 0, index = 0; start < chars.length; start += size, index++) {
    const part = chars.slice(start, start + size);
    const bits = new BitReader(digest('chunk', context, `${size}:${index}:${part.join('')}`));
    const tile = readTile(bits);
    tokens.push({ ...tile, index, start, length: part.length, word: WORDS[bits.read(WORD_BITS)] });
  }
  return tokens;
}

// ---- Fingerprint ---------------------------------------------------------------------------

export interface FingerprintOptions extends HashContext {
  readonly chunkSize: number;
}

export interface Fingerprint {
  readonly context: HashContext;
  readonly normalized: string;
  /** Length in Unicode code points. */
  readonly length: number;
  /** Plain SHA-256 of the normalized UTF-8 text, for cross-checking with other tools. */
  readonly sha256: string;
  readonly story: Story;
  readonly words: readonly string[];
  readonly tiles: readonly Tile[];
  readonly chunks: readonly ChunkToken[];
}

/** Returns null when there is nothing to fingerprint after normalization. */
export function fingerprint(input: string, options: FingerprintOptions): Fingerprint | null {
  const normalized = normalize(input, options.mode);
  if (normalized.length === 0) return null;
  const context: HashContext = { mode: options.mode, date: options.date };
  return {
    context,
    normalized,
    length: Array.from(normalized).length,
    sha256: toHex(sha256(new TextEncoder().encode(normalized))),
    story: makeStory(normalized, context),
    words: wordCode(normalized, context),
    tiles: emojiStrip(normalized, context),
    chunks: chunkTokens(normalized, options.chunkSize, context),
  };
}
