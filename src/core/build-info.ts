import { ALGORITHM_VERSIONS } from './version';

/** Hash of the algorithm source and tables, injected at build time. */
export const ALGORITHM_HASH: string = __ALGORITHM_HASH__;

/** Production builds fail before this can be 'unreleased'; dev servers may show it. */
export const ALGORITHM_VERSION: string = ALGORITHM_VERSIONS[ALGORITHM_HASH] ?? 'unreleased';
