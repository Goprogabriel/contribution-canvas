import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'public'), output, { recursive: true });
await cp(path.join(root, 'src', 'core'), path.join(output, 'core'), { recursive: true });
await cp(path.join(root, 'docs'), path.join(output, 'docs'), { recursive: true });
for (const filename of ['README.md', 'README.da.md', 'SECURITY.md', 'LICENSE']) {
  await cp(path.join(root, filename), path.join(output, filename));
}
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(
  path.join(output, 'build-info.json'),
  `${JSON.stringify({ name: 'Contribution Canvas', mode: 'hosted-safe-demo', version: '1.0.0' }, null, 2)}\n`,
);
console.log(`Built static GitHub Pages site in ${output}`);
