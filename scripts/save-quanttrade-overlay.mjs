import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkout = resolve(root, 'upstream/pairlens');
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { maxBuffer: 20 * 1024 * 1024 });
const allowed = (path) => path.startsWith('packages/plugins/src/nanogpt-inference/') || path === 'packages/plugins/src/index.ts' || path === 'packages/plugins/src/lib/inference-sse.ts' || path.startsWith('apps/terminal/') || path.startsWith('packages/plugin-sdk/src/hooks/use-plugin-fetch') || path === 'apps/marketing/src/content/docs/terminal-tour.md' || path === 'packages/plugins/src/pairlens-cex-futures/workspaces.ts';
const paths = git('diff', '--name-only', 'HEAD').toString().trim().split('\n').filter((path) => allowed(path) && !path.endsWith('routeTree.gen.ts'));
mkdirSync(resolve(root, 'patches'), { recursive: true });
writeFileSync(resolve(root, 'patches/quanttrade.patch'), git('diff', '--binary', 'HEAD', '--', ...paths));
const additions = git('ls-files', '--others', '--exclude-standard').toString().trim().split('\n').filter(allowed);
for (const path of additions) {
  const destination = resolve(root, 'overlays/pairlens', path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(checkout, path), destination);
}
writeFileSync(resolve(root, 'patches/quanttrade-files.json'), JSON.stringify(additions, null, 2) + '\n');
const lock = JSON.parse(readFileSync(resolve(root, 'upstream-lock.json'), 'utf8'));
console.log(`Saved QuantTrade patch and ${additions.length} added files against ${lock.pairlens.revision}.`);
