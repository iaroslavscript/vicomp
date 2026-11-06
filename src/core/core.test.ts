import { describe, expect, it } from 'vitest';
import { COLORS, SYMBOLS, TRANSPORT_BANDS } from '../data/glyphs';
import { WORDS_RAW } from '../data/words';
import {
  BitReader,
  CITIES,
  COLOR_BITS,
  MEDIUM_LIMIT,
  NEXT_BITS,
  NORMALIZE_PARAMS,
  SHORT_LIMIT,
  START_BITS,
  SYMBOL_BITS,
  TILE_COUNT,
  TRANSPORT_BITS,
  WORD_BITS,
  WORD_COUNT,
  STORY_BITS,
  STORY_LEGS,
  WORDS,
  chord2,
  chunkTokens,
  contextHeader,
  emojiStrip,
  fingerprint,
  makeStory,
  nearest,
  normalize,
  sha256,
  toHex,
  utcDate,
  wordCode,
  type HashContext,
  type NormalizeMode,
} from './algorithm';
import { ALGORITHM_HASH, ALGORITHM_VERSION } from './build-info';
import { ALGORITHM_VERSIONS } from './version';

const CTX: HashContext = { mode: 'ws-case', date: null };

const encode = (s: string) => new TextEncoder().encode(s);

// Deterministic pseudo-random strings for property tests.
function* randomStrings(count: number, seed = 42): Generator<string> {
  let state = seed;
  const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0);
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < count; i++) {
    const len = 8 + (next() % 40);
    yield Array.from({ length: len }, () => alphabet[next() % alphabet.length]).join('');
  }
}

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(toHex(sha256(encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256(encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches WebCrypto across block boundaries', async () => {
    for (let len = 0; len < 200; len++) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 31 + len) & 0xff);
      const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      expect(toHex(sha256(data)), `length ${len}`).toBe(toHex(expected));
    }
  });
});

describe('BitReader', () => {
  it('reads MSB-first across byte boundaries', () => {
    const r = new BitReader(Uint8Array.of(0b10110011, 0b01011100));
    expect(r.read(3)).toBe(0b101);
    expect(r.read(7)).toBe(0b1001101);
    expect(r.read(6)).toBe(0b011100);
    expect(() => r.read(1)).toThrow(RangeError);
  });

  it('has enough bits for the story', () => {
    expect(STORY_BITS).toBeLessThanOrEqual(256);
  });
});

describe('normalize', () => {
  const iban = ' de89 3704\t0044 0532 0130 00\n';
  it('ignores whitespace and case by default mode', () => {
    expect(normalize(iban, 'ws-case')).toBe('DE89370400440532013000');
  });
  it('keeps case in ws mode', () => {
    expect(normalize(iban, 'ws')).toBe('de89370400440532013000');
  });
  it('drops punctuation in alnum mode', () => {
    expect(normalize('978-3-16-148410-0', 'alnum')).toBe('9783161484100');
  });
  it('keeps everything in exact mode', () => {
    expect(normalize(iban, 'none')).toBe(iban);
  });
  it('strips invisible copy & paste characters', () => {
    expect(normalize('AB\u200bC\ufeffD', 'ws')).toBe('ABCD');
  });
  it('unifies Unicode composition', () => {
    expect(normalize('Cafe\u0301', 'ws')).toBe(normalize('Caf\u00e9', 'ws'));
  });
});

describe('frozen data tables', () => {
  it('has 2048 cities with distinct names and known countries', () => {
    expect(CITIES).toHaveLength(2048);
    expect(new Set(CITIES.map((c) => c.name.toLowerCase())).size).toBe(2048);
    for (const c of CITIES) {
      expect(c.country, c.name).not.toBe(c.countryCode);
      expect(Number.isInteger(c.x) && Number.isInteger(c.y) && Number.isInteger(c.z)).toBe(true);
    }
  });

  it('has 2048 distinct words and 64 distinct symbols', () => {
    expect(WORDS).toHaveLength(2048);
    expect(new Set(WORDS).size).toBe(2048);
    expect(WORDS_RAW.split(' ')[0]).toBe('abandon');
    expect(new Set(SYMBOLS.map((s) => s.emoji)).size).toBe(64);
    expect(new Set(SYMBOLS.map((s) => s.name)).size).toBe(64);
    expect(COLORS).toHaveLength(8);
  });

  it('has 8 distinct transports per band', () => {
    for (const band of TRANSPORT_BANDS) {
      expect(band).toHaveLength(8);
      expect(new Set(band.map((t) => t.emoji)).size).toBe(8);
    }
  });

  it('finds nearest cities in ascending distance order', () => {
    for (const from of CITIES.filter((_, i) => i % 97 === 0)) {
      const exclude = new Set([from.index, (from.index + 1) % 2048]);
      const expected = CITIES.filter((c) => !exclude.has(c.index))
        .map((c) => ({ c, d: chord2(from, c) }))
        .sort((a, b) => a.d - b.d || a.c.index - b.c.index)
        .slice(0, 32)
        .map(({ c }) => c.index);
      expect(nearest(from, 32, exclude).map((c) => c.index)).toEqual(expected);
    }
    const vilnius = CITIES.find((c) => c.name === 'Vilnius')!;
    expect(nearest(vilnius, 5, new Set([vilnius.index])).map((c) => c.name)).toContain('Kaunas');
  });
});

describe('story', () => {
  it('visits distinct cities over a fixed number of legs', () => {
    for (const s of randomStrings(50)) {
      const story = makeStory(s, CTX);
      expect(story.legs).toHaveLength(STORY_LEGS);
      const visited = [story.start, ...story.legs.map((l) => l.to)].map((c) => c.index);
      expect(new Set(visited).size).toBe(STORY_LEGS + 1);
      story.legs.forEach((leg, i) => expect(leg.from).toBe(i === 0 ? story.start : story.legs[i - 1].to));
    }
  });

  it('is deterministic', () => {
    expect(makeStory('DE89370400440532013000', CTX).text).toBe(makeStory('DE89370400440532013000', CTX).text);
  });
});

describe('avalanche: one changed symbol changes every view', () => {
  it('for substitutions, insertions, deletions and swaps', () => {
    let checked = 0;
    for (const s of randomStrings(200, 7)) {
      const pos = s.length >> 1;
      const variants = [
        s.slice(0, pos) + (s[pos] === '0' ? '1' : '0') + s.slice(pos + 1),
        s.slice(0, pos) + 'X' + s.slice(pos),
        s.slice(0, pos) + s.slice(pos + 1),
        s.slice(0, pos) + s[pos + 1] + s[pos] + s.slice(pos + 2),
        s.slice(0, -1) + (s.at(-1) === 'A' ? 'B' : 'A'),
      ].filter((v) => v !== s);
      const base = makeStory(s, CTX);
      for (const v of variants) {
        const story = makeStory(v, CTX);
        expect(story.text).not.toBe(base.text);
        // The difference must show up right at the beginning of the story.
        expect(story.start === base.start && story.legs[0].to === base.legs[0].to).toBe(false);
        expect(wordCode(v, CTX)).not.toEqual(wordCode(s, CTX));
        expect(emojiStrip(v, CTX)).not.toEqual(emojiStrip(s, CTX));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(800);
  });
});

describe('chunks', () => {
  it('only the chunk containing a change differs', () => {
    const a = chunkTokens('DE89370400440532013000', 4, CTX);
    const b = chunkTokens('DE89370400440582013000', 4, CTX);
    expect(a).toHaveLength(6);
    const differing = a.map((t, i) => (t.word === b[i].word && t.symbol === b[i].symbol && t.color === b[i].color ? -1 : i));
    expect(differing.filter((i) => i >= 0)).toEqual([3]);
    expect(a.at(-1)).toMatchObject({ start: 20, length: 2 });
  });

  it('distinguishes equal chunks at different positions', () => {
    const [first, second] = chunkTokens('ABCDABCD', 4, CTX);
    expect(first.word === second.word && first.symbol === second.symbol).toBe(false);
  });
});

describe('fingerprint', () => {
  it('equal after normalization means equal fingerprint', () => {
    const opts = { mode: 'ws-case', date: null, chunkSize: 4 } as const;
    expect(fingerprint('de89 3704 0044 0532 0130 00', opts)).toEqual(fingerprint('DE89370400440532013000', opts));
  });

  it('returns null for blank input', () => {
    expect(fingerprint('  \n', { mode: 'ws-case', date: null, chunkSize: 4 })).toBeNull();
  });
});

describe('hash context', () => {
  it('takes the calendar date in UTC, ignoring the local time zone', () => {
    expect(utcDate(new Date('2026-10-30T23:30:00-05:00'))).toBe('2026-10-31');
    expect(utcDate(new Date('2026-10-31T00:30:00+03:00'))).toBe('2026-10-30');
  });

  it('puts fixed metadata fields before the value', () => {
    expect(contextHeader('story', { mode: 'ws-case', date: '2026-10-30' })).toBe(
      'vicomp/v2/story\0normalize=nfc,strip-invisible,strip-whitespace,ignore-case\0date=2026-10-30\0',
    );
    expect(contextHeader('words', { mode: 'none', date: null })).toBe('vicomp/v2/words\0normalize=exact\0date=none\0');
    expect(() => contextHeader('story', { mode: 'none', date: '30.10.2026' })).toThrow(RangeError);
  });

  it('different normalization rules give different results even for the same normalized text', () => {
    const modes = ['ws-case', 'alnum', 'ws', 'none'] as const;
    for (const mode of modes) expect(normalize('ABC123', mode)).toBe('ABC123');
    const results = modes.map((mode) => fingerprint('ABC123', { mode, date: null, chunkSize: 4 })!);
    for (const view of ['story', 'words', 'tiles', 'chunks'] as const) {
      expect(new Set(results.map((r) => JSON.stringify(r[view]))).size, view).toBe(modes.length);
    }
  });

  it('the optional date changes every view, and every day differs', () => {
    const at = (date: string | null) => fingerprint('DE89370400440532013000', { mode: 'ws-case', date, chunkSize: 4 })!;
    const [none, d1, d2] = [at(null), at('2026-10-30'), at('2026-10-31')];
    for (const view of ['story', 'words', 'tiles', 'chunks'] as const) {
      expect(JSON.stringify(d1[view]), view).not.toBe(JSON.stringify(none[view]));
      expect(JSON.stringify(d2[view]), view).not.toBe(JSON.stringify(d1[view]));
    }
    expect(d1.sha256).toBe(none.sha256);
    expect(d1.context).toEqual({ mode: 'ws-case', date: '2026-10-30' });
  });
});

// Golden vectors freeze algorithm v3. If these change, every user comparing with an
// older cached copy of the app would see different stories: use a new version in version.ts.
describe('golden vectors (algorithm v3)', () => {
  const golden = (input: string, mode: NormalizeMode = 'ws-case', date: string | null = null) => {
    const fp = fingerprint(input, { mode, date, chunkSize: 4 })!;
    return {
      story: fp.story.text,
      words: fp.words.join(' '),
      tiles: fp.tiles.map((t) => `${t.symbol.emoji}${t.color.name}`).join(' '),
      chunks: fp.chunks.map((c) => `${c.symbol.emoji}${c.color.name}:${c.word}`).join(' '),
    };
  };

  it('IBAN', () => {
    expect(golden('DE89 3704 0044 0532 0130 00')).toMatchInlineSnapshot(`
      {
        "chunks": "🐮orange:vast 🌙purple:salute 🍄purple:intact ⚡red:order 🐍orange:gossip 🥕purple:gaze",
        "story": "From Kismayo (Somalia) 🎈 by balloon to Arba Minch (Ethiopia), then 🏍️ by motorbike to Juba (South Sudan), then 🏍️ by motorbike to Jimma (Ethiopia), then 🚌 by bus to Addis Ababa, then 🚌 by bus to Arabi and finally ⛵ by sailboat to Awasa.",
        "tiles": "☀️red 🦒pink 🍕blue ❄️red ☀️blue 🐳yellow 🦀pink ❄️purple",
        "words": "famous motion alpha top pretty",
      }
    `);
  });

  it('MD5', () => {
    expect(golden('d41d8cd98f00b204e9800998ecf8427e')).toMatchInlineSnapshot(`
      {
        "chunks": "🌈cyan:ice 🦊purple:bike 🍉pink:soup 🐫yellow:bench ❄️green:mushroom 🐷blue:warrior 🍒green:soup 🐝green:boost",
        "story": "From Antwerp (Belgium) 🚚 hitchhiking a truck to Southend-on-Sea (United Kingdom), then 🚌 by bus to Kingston upon Hull, then 🚗 by car to Swansea, then 🚚 hitchhiking a truck to Leicester, then 🚜 by tractor to Glasgow and finally 🚌 by bus to Milton Keynes.",
        "tiles": "🍓pink 🐧red 🐢red 🦀purple 🎸purple 🍋purple 🎂orange 🍒pink",
        "words": "photo arm stone meadow quiz",
      }
    `);
  });

  it('ISBN', () => {
    expect(golden('978-3-16-148410-0')).toMatchInlineSnapshot(`
      {
        "chunks": "🔑purple:vibrant 🌵pink:friend 🐫blue:faculty 🐝purple:panel 🍋purple:wheel",
        "story": "From Rustaq (Oman) ✈️ by plane to Kuwait City (Kuwait), then 🚐 by camper van to Al 'Amarah (Iraq), then 🚜 by tractor to Al Hillah, then 🚌 by bus to Kermanshah (Iran), then ⛵ by sailboat to Dezful and finally 🚚 hitchhiking a truck to Zanjan.",
        "tiles": "🍍yellow 🌙orange 🌈pink 🐌blue 🦉cyan 🌙cyan ⚡cyan 🍓green",
        "words": "amused omit heart initial asset",
      }
    `);
  });

  it('IBAN with date', () => {
    expect(golden('DE89 3704 0044 0532 0130 00', 'ws-case', '2026-10-30')).toMatchInlineSnapshot(`
      {
        "chunks": "🐌green:daughter 🦄purple:satisfy 🍁orange:high 🍌blue:already 🐌yellow:fruit 🐞pink:dry",
        "story": "From Austin (United States) ⛵ by sailboat to Reynosa (Mexico), then 🚢 by ship to Albuquerque (United States), then 🚁 by helicopter to Fresno, then ⛵ by sailboat to Los Angeles, then 🐉 on a dragon to Saltillo (Mexico) and finally 🚚 hitchhiking a truck to Toluca.",
        "tiles": "🍍cyan 🍌green 🐌cyan ❄️red 🔔yellow 🎂orange 🐼green 🔑yellow",
        "words": "mammal napkin energy involve submit",
      }
    `);
  });
});

// What each algorithm version produces. Mapping a new algorithm hash to an existing version
// in version.ts is only allowed when both still match:
// - tables: every output-affecting table entry and constant (formatting-independent);
// - corpus: the outputs for a generated set of inputs (catches logic changes).
const PINNED: Readonly<Record<string, { tables: string; corpus: string }>> = {
  v2: {
    tables: '2a05ecd595659ce11044607d42e0ffcb3559d218fe3279bebb8a0aafdd6d352c',
    corpus: '3346b379b8c4672c88e76470ac1c316c5e5fc51e8ca896fc22adb2041b2e1206',
  },
  v3: {
    tables: '6a6ce41c3fa50c70feda43120c1327dd0935724ad2f7ed07e26f402905f05205',
    corpus: '1237a0a9db9cf4acf1bffa5c9da3f94c6345b26873008a14315056779512f9d5',
  },
};

const tablesHash = (): string =>
  toHex(
    sha256(
      encode(
        JSON.stringify({
          cities: CITIES.map((c) => [c.name, c.countryCode, c.country, c.lat, c.lon, c.x, c.y, c.z]),
          transports: TRANSPORT_BANDS.map((band) => band.map((t) => [t.emoji, t.phrase])),
          symbols: SYMBOLS.map((g) => [g.emoji, g.name]),
          colors: COLORS.map((c) => [c.name, c.hex]),
          words: WORDS,
          normalize: NORMALIZE_PARAMS,
          constants: [SHORT_LIMIT, MEDIUM_LIMIT, STORY_LEGS, START_BITS, NEXT_BITS, TRANSPORT_BITS],
          bits: [SYMBOL_BITS, COLOR_BITS, WORD_BITS, WORD_COUNT, TILE_COUNT],
        }),
      ),
    ),
  );

describe('algorithm version', () => {
  it('the algorithm hash is acknowledged in version.ts', () => {
    expect(
      ALGORITHM_VERSIONS[ALGORITHM_HASH],
      `Unacknowledged algorithm hash, run 'pnpm algorithm:hash' and add it to version.ts: ${ALGORITHM_HASH}`,
    ).toBeDefined();
  });

  it('tables match the ones pinned for this version', () => {
    expect(
      tablesHash(),
      `Tables differ from algorithm ${ALGORITHM_VERSION}: map the hash to a new version and pin it`,
    ).toBe(PINNED[ALGORITHM_VERSION]?.tables);
  });

  it('outputs match the corpus pinned for this version', () => {
    const modes: NormalizeMode[] = ['ws-case', 'alnum', 'ws', 'none'];
    const lines: string[] = [];
    let i = 0;
    for (const raw of randomStrings(400, 7)) {
      const input = i % 2 ? raw.toLowerCase().replace(/(.{4})/g, '$1 -') : raw;
      const mode = modes[i % modes.length];
      const date = i % 3 === 0 ? `2026-${String((i % 12) + 1).padStart(2, '0')}-15` : null;
      const fp = fingerprint(input, { mode, date, chunkSize: 4 })!;
      lines.push(
        [
          fp.story.text,
          fp.words.join(' '),
          fp.tiles.map((t) => t.symbol.emoji + t.color.name).join(''),
          fp.chunks.map((c) => c.symbol.emoji + c.color.name + c.word).join(''),
        ].join('|'),
      );
      i++;
    }
    expect(
      toHex(sha256(encode(lines.join('\n')))),
      `Outputs differ from algorithm ${ALGORITHM_VERSION}: map the hash to a new version and pin its corpus`,
    ).toBe(PINNED[ALGORITHM_VERSION]?.corpus);
  });
});
