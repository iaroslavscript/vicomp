import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { algorithmHash, resolveAlgorithmVersion } from './scripts/algorithm-hash';
import { ALGORITHM_VERSIONS } from './src/core/version';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? 'unknown';
  }
}

/** Production builds fail on an unacknowledged algorithm hash; the dev server only warns. */
function checkedAlgorithmHash(command: 'build' | 'serve'): string {
  const hash = algorithmHash();
  try {
    resolveAlgorithmVersion(hash, ALGORITHM_VERSIONS);
  } catch (error) {
    if (command === 'build') throw error;
    console.warn(`\n${(error as Error).message}\nThe dev server shows the algorithm as 'unreleased'.\n`);
  }
  return hash.key;
}

export default defineConfig(({ command }) => ({
  // Relative base works for GitHub Pages project sites (/<repo>/) and local previews.
  base: './',
  build: { target: 'es2022' },
  // Shown in the UI only; deliberately not part of the hash, so different deploys of the
  // same algorithm version still produce identical results.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
    __ALGORITHM_HASH__: JSON.stringify(checkedAlgorithmHash(command)),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      pwaAssets: {
        image: 'public/logo.svg',
        preset: 'minimal-2023',
        overrideManifestIcons: true,
      },
      manifest: {
        name: 'Vicomp: visual compare',
        short_name: 'Vicomp',
        description:
          'Turn IBANs, hashes, keys and other codes into travel stories, emoji and maps you can compare at a glance.',
        theme_color: '#1e3a5f',
        background_color: '#f5f7fa',
        display: 'standalone',
        start_url: '.',
        scope: '.',
      },
      workbox: {
        // manifest.webmanifest is added by the plugin itself; listing it here too makes
        // Workbox throw on the duplicate entry, which silently disables offline support.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
}));
