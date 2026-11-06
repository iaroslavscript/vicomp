# Vicomp: visual compare

Compare long codes (IBAN, ISBN, MD5/SHA hashes, keys, serial numbers…) on two computers **by eye**.
Open the app on both machines, paste the value, and compare pictures instead of characters. A
difference of even one symbol changes everything you see.

For every value Vicomp shows a **fingerprint** up front, plus more views in tabs below it:

| View | Where | What it is | Bits |
| --- | --- | --- | --- |
| **Emoji tiles** | Fingerprint | 8 emoji on coloured tiles, always in one row | 72 |
| **Word code** | Fingerprint | 5 words from the BIP39 list | 55 |
| **Journey** | Tab | A 6-leg trip between real cities drawn on an offline world map, next to the list of legs (click the map to enlarge it; click again, press Esc or ✕ to close), e.g. *🎈 by balloon to Arba Minch 🛂 Ethiopia*. *Copy as text* includes it as a sentence. | 59 |
| **Difference** | Tab (or *They don't match? Find the difference*) | Each chunk of N characters gets its own emoji, colour and word, so you can find *which* part differs. Point at or click a cell to highlight its characters in the value (Esc clears); the cell you are typing in is outlined and kept in view below the input, which stays on screen while this tab is open | 20 per chunk |
| **Details** | Tab | Normalized value, SHA-256 and the settings mixed into the result | — |

Normalization and the daily date are under **⚙ Options**. The active settings are always shown under
the input, so both computers can check that they match. Chunk size only affects the *Difference* view
and is set there.

The app is a static, installable PWA. It works offline and never sends or stores the value you
type; only the settings (including the last open tab) are saved in `localStorage`.

## Run online

**▶ <https://iaroslavscript.github.io/vicomp/>**

The application is hosted on GitHub Pages and runs directly in the browser on
desktop, phone and tablet. **There is no need to build anything unless you
are a developer** — just open the link. To keep it like an app (and use
offline), use your browser's *Install* / *Add to Home Screen* option — in
Chrome that is the install icon in the address bar on desktop, or
**⋮ → Add to Home screen** on Android.

## How the fingerprint works (algorithm `v3`)

1. **Normalize** the input. The default ignores whitespace and case. Other modes: letters & digits
   only, whitespace only, or exact text. Except in exact mode, the text is NFC-normalized and
   invisible copy & paste characters (zero-width space, BOM, …) are removed. Both computers must use
   the same mode, which is shown under the input.
2. Optionally, **today's date in UTC** (`YYYY-MM-DD`, no time) is mixed in. It is off by default and
   not remembered between visits. It makes every result change daily, so an old screenshot or a
   story remembered from yesterday cannot pass as today's. Both computers must enable it, and
   comparisons right around midnight UTC may see different dates.
3. Every view reads from its own **domain-separated SHA-256** over a fixed header followed by the
   value:

   ```text
   SHA-256("vicomp/v2/<view>\0normalize=<rules>\0date=<YYYY-MM-DD|none>\0" + normalized)
   ```

   `<rules>` spells out the normalization, e.g. `nfc,strip-invisible,strip-whitespace,ignore-case`.
   So the same value compared under different settings never looks alike, which prevents a false
   match between a strict and a lenient comparison. Changing any symbol changes every view
   completely, from its very first element.
4. **Story**: 11 bits pick the start city from 2048 cities. For each of 6 legs, 5 bits pick one of
   the 32 nearest unvisited cities and 3 bits pick one of 8 transports. The set of 8 transports
   depends on leg length (< 150 km, < 800 km, longer), so it stays plausible. Border crossings are
   derived from the cities' countries.
5. **Chunks** are hashed with their size and position, so a moved chunk looks different too.

The chance that a different value produces the same story is about 1 in 2⁵⁹. This catches typos
and copy & paste mistakes reliably. It is **not** a defence against an attacker deliberately
searching for a collision.

### Stability across devices

The output must be identical on every browser and OS:

- SHA-256 is implemented in plain TypeScript (no WebCrypto dependency, works on `http://` too).
- Nearest-city ranking uses pre-computed integer coordinates, so floating-point differences between
  JavaScript engines cannot change a route.
- All tables (cities, countries, words, emoji, colours, transports) are frozen and covered by
  golden test vectors. The Playwright suite checks the golden story in Chromium, Firefox and WebKit.

### Algorithm version

The whole algorithm lives in one file, [src/core/algorithm.ts](src/core/algorithm.ts), which may only
import the data tables in [src/data/](src/data/) (except the display-only land outlines). On every
build, [scripts/algorithm-hash.ts](scripts/algorithm-hash.ts) hashes that file and those tables
(line endings normalized). The displayed version is looked up in a static map in
[src/core/version.ts](src/core/version.ts):

```ts
export const ALGORITHM_VERSIONS = {
  '5056b20f…': 'v2',
  'c740b83a…': 'v3',
};
```

**`pnpm build` fails when the current hash is not in the map**, printing the line to add. Nobody
can change code or data without deciding what the change means:

- outputs can change → add the hash with a **new** version (e.g. `'v4'`) and pin its expected tables and
  corpus hashes in [src/core/core.test.ts](src/core/core.test.ts);
- outputs are identical (comments, refactoring) → add the hash with the **same** version.

Unit tests keep that decision honest. Per version they pin a hash of every table entry and constant,
and a hash of the outputs for 400 generated inputs across all modes. Filing a renamed city or a
logic change under an existing version fails these tests. Entries are never removed from the map.
`pnpm algorithm:hash` prints the current hash; the dev server only warns and shows `unreleased`. The
hash tag in the digest header (`vicomp/v2`) is a frozen constant inside the algorithm, independent
of the displayed version.

The footer also shows the app version (from `package.json`) and the git commit of the build. These
are deliberately **not** part of the hash: an installed PWA can easily be one deploy behind, and a
redeploy that does not change the algorithm (styling, texts, docs) must not make identical values
look different.

## Development

```sh
pnpm install
pnpm dev          # dev server
pnpm test         # unit tests (Vitest)
pnpm build        # type-check + production build into dist/
pnpm test:e2e     # Playwright tests against the production build
pnpm lint
pnpm algorithm:hash # print the algorithm hash for src/core/version.ts
```

Pushing to `main` deploys to GitHub Pages via [.github/workflows/pages.yml](.github/workflows/pages.yml).
In the repository settings, set *Pages → Source* to **GitHub Actions**.

### Data

`src/data/*.ts` are generated by `pnpm data` ([scripts/build-data.mjs](scripts/build-data.mjs)) and
committed, except the hand-written emoji, colour and transport tables in
[src/data/glyphs.ts](src/data/glyphs.ts). Any change needs a new entry in the version map (the build
enforces this).

- Cities and country names: [GeoNames](https://www.geonames.org/) — CC BY 4.0
- Land outlines: [Natural Earth](https://www.naturalearthdata.com/) 1:50m — public domain
- Word list: [BIP39 English](https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt) — MIT

## License

[MIT](LICENSE) © 2026 [Iaroslav Akimov](https://github.com/iaroslavscript). Built with GitHub Copilot.
