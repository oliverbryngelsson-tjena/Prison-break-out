import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// Build id shown in the menu and published as version.json, so open games can notice a new deploy.
function commitId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; }
}

function versionFile(build: string, date: string): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build, date }) + '\n' });
    },
  };
}

export default defineConfig(({ command }) => {
  const build = command === 'build' ? commitId() : 'dev';
  const date = new Date().toISOString().slice(0, 10);
  return {
    base: './',
    define: { __BUILD__: JSON.stringify(build), __BUILD_DATE__: JSON.stringify(date) },
    plugins: [versionFile(build, date)],
    server: { host: true, port: 5173, proxy: { '/ws': { target: 'ws://localhost:8080', ws: true }, '/health': 'http://localhost:8080' } },
    build: {
      target: 'es2020',
      outDir: 'dist',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
      },
    },
  };
});
