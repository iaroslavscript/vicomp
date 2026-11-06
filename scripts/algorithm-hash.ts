// Computes the hash that identifies the algorithm: src/core/algorithm.ts plus every data
// table it imports. Used by vite.config.ts / vitest.config.ts; run directly to print it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const ALGORITHM_SOURCE = 'src/core/algorithm.ts';
/** Data tables the algorithm may import. Anything else is rejected, so nothing escapes the hash. */
export const ALGORITHM_TABLES = [
  'src/data/cities.ts',
  'src/data/countries.ts',
  'src/data/glyphs.ts',
  'src/data/words.ts',
] as const;

export interface AlgorithmHash {
  /** Combined hash, the key in src/core/version.ts. */
  readonly key: string;
  readonly source: string;
  readonly tables: string;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

// Line endings and BOM depend on the checkout (e.g. Git autocrlf on Windows), not on the code.
const read = (root: string, file: string): string =>
  readFileSync(join(root, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

const IMPORT = /\b(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;

function imports(text: string): string[] {
  return Array.from(text.matchAll(IMPORT), (m) => m[1] ?? m[2] ?? m[3]);
}

export function algorithmHash(root: string = ROOT): AlgorithmHash {
  const source = read(root, ALGORITHM_SOURCE);
  const allowed = new Set<string>(ALGORITHM_TABLES);
  for (const spec of imports(source)) {
    const target = spec.startsWith('.') ? posix.join(posix.dirname(ALGORITHM_SOURCE), spec) : spec;
    const file = target.endsWith('.ts') ? target : `${target}.ts`;
    if (!allowed.has(file)) {
      throw new Error(
        `${ALGORITHM_SOURCE} imports '${spec}', which is not covered by the algorithm hash. ` +
          `Move that code into ${ALGORITHM_SOURCE} or add the table to ALGORITHM_TABLES in ${relative(root, fileURLToPath(import.meta.url))}.`,
      );
    }
  }
  const tables = ALGORITHM_TABLES.map((file) => {
    const text = read(root, file);
    const found = imports(text);
    if (found.length > 0) throw new Error(`${file} must not import anything, found '${found[0]}'.`);
    return `${file}\n${sha256(text)}\n`;
  }).join('');
  const sourceHash = sha256(source);
  const tablesHash = sha256(tables);
  return { key: sha256(`source=${sourceHash}\ntables=${tablesHash}\n`), source: sourceHash, tables: tablesHash };
}

/** Throws a build error with copy-paste instructions when the hash is not acknowledged. */
export function resolveAlgorithmVersion(hash: AlgorithmHash, versions: Readonly<Record<string, string>>): string {
  const version = versions[hash.key];
  if (version) return version;
  throw new Error(
    [
      'The algorithm or its data tables changed, and this hash is not acknowledged:',
      `  key:    ${hash.key}`,
      `  source: ${hash.source} (${ALGORITHM_SOURCE})`,
      `  tables: ${hash.tables} (${ALGORITHM_TABLES.join(', ')})`,
      'Add it to ALGORITHM_VERSIONS in src/core/version.ts:',
      `  '${hash.key}': 'vN',`,
      'Use a new version if any output can change, or the current one if outputs are identical.',
    ].join('\n'),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(algorithmHash(), null, 2));
}
