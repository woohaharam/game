import { defineConfig, type Plugin } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Portal SDKs are loaded by a script tag in the page, not by an import.
 *
 * They are not on npm in any form worth using, they expect to be a global, and
 * each portal wants only its own. So the tag is injected at build time and the
 * portal is chosen by `DD_PORTAL`, producing one bundle per destination from
 * one source tree:
 *
 *     npm run build                # no SDK — GitHub Pages, itch.io, local
 *     npm run build:crazygames     # CrazyGames submission
 *     npm run build:poki           # Poki submission
 *
 * These URLs are the portals' published entry points and they do change. The
 * game does not depend on being right about them: `detectAdProvider` looks for
 * the global, and a script that 404s simply means no global, which the runtime
 * already treats as "no ads available" rather than as an error. A wrong URL
 * costs revenue, never a broken game — so verify against current docs before a
 * submission, and check the network tab.
 */
const PORTAL_SDKS: Record<string, string> = {
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
};

function portalSdk(portal: string | undefined): Plugin {
  const src = portal === undefined ? undefined : PORTAL_SDKS[portal];

  return {
    name: 'deepdelve:portal-sdk',
    transformIndexHtml(html) {
      if (portal !== undefined && src === undefined) {
        throw new Error(
          `DD_PORTAL="${portal}" is not a portal this build knows about. ` +
            `Expected one of: ${Object.keys(PORTAL_SDKS).join(', ')}`,
        );
      }
      if (src === undefined) return html;

      // Ahead of the module script and not deferred: the SDK has to have
      // defined its global before the game looks for it. The game tolerates it
      // being absent, but a race would make ad inventory depend on network
      // timing, which is the kind of bug that only appears in production.
      return html.replace('</head>', `  <script src="${src}"></script>\n  </head>`);
    },
  };
}

/**
 * Web-portal builds are served from an unknown subdirectory, so every asset
 * reference has to be relative rather than rooted at `/`. That also happens to
 * be what lets the same bundle sit under /deepdelve/ on GitHub Pages.
 */
export default defineConfig({
  base: './',
  plugins: [portalSdk(process.env.DD_PORTAL)],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@game': fileURLToPath(new URL('./src/game', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@platform': fileURLToPath(new URL('./src/platform', import.meta.url)),
    },
  },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
