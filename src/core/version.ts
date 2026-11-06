/**
 * Acknowledged algorithm hashes → displayed algorithm version.
 *
 * The key is computed at build time by scripts/algorithm-hash.ts from src/core/algorithm.ts
 * and the data tables it imports. `pnpm build` fails when the current hash is missing here,
 * so neither code nor data can change without someone deciding what the change means:
 *
 * - outputs changed  → add the new hash with a NEW version (e.g. 'v3');
 * - outputs identical (comments, refactoring) → add the new hash with the SAME version.
 *   The golden and corpus tests verify that the outputs really are identical.
 *
 * Entries are never removed, so any past build can be traced back to its version.
 */
export const ALGORITHM_VERSIONS: Readonly<Record<string, string>> = {
  // v2: digests also cover the normalization rules and the optional UTC date.
  '5056b20f22e20397582dff2531f461dd68c8014bc8dc98dc63eba453ca7de7ba': 'v2',
  // v3: look-alike transports and symbols replaced by visually distinct ones.
  'c740b83a8e85518264a11a9f9d04fd6ac5057ec031a82cd4b8634f52901404b9': 'v3',
};
