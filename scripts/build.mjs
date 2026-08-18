/**
 * "Build" for a no-bundler static site: copy the publishable subset into dist/.
 * Everything the browser needs is already plain files in the repo, including
 * the locally cached photos, so this is a copy step rather than a compile step.
 */
import { cp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const dist = path.join(root, 'dist');

const ENTRIES = ['index.html', 'assets', 'data', 'images', 'vendor'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ENTRIES) {
  const from = path.join(root, entry);
  if (!existsSync(from)) {
    console.warn(`skip (missing): ${entry}`);
    continue;
  }
  await cp(from, path.join(dist, entry), { recursive: true });
  console.log(`copied: ${entry}`);
}

// Tell GitHub Pages not to run the files through Jekyll.
await writeFile(path.join(dist, '.nojekyll'), '');
console.log(`\nbuilt -> ${dist}`);
