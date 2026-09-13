import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const lpcRoot = path.join(projectRoot, 'public/assets/dungeon-overlay/lpc-v1');
const outputPath = path.join(lpcRoot, 'CREDITS.txt');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

async function creditFiles(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const childRelative = path.posix.join(relative, entry.name);
    const childPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await creditFiles(childPath, childRelative)));
    else if (entry.isFile() && /^(?:credits\.txt)$/i.test(entry.name) && childRelative !== 'CREDITS.txt')
      files.push(childRelative);
  }
  return files;
}

export async function generateDungeonLpcCredits(options = {}) {
  const root = options.lpcRoot ?? lpcRoot;
  const destination = options.outputPath ?? outputPath;
  const files = await creditFiles(root);
  const sections = [];
  for (const relative of files) {
    const content = (await readFile(path.join(root, ...relative.split('/')), 'utf8')).trim();
    sections.push(`SOURCE CREDIT FILE: ${relative}\n${'-'.repeat(80)}\n${content}`);
  }
  const header = [
    'TNX6 DUNGEON — UNIVERSAL LPC FULL ASSET CREDITS',
    'Generated deterministically from the repository credit files listed below.',
    'An asset in the generated source catalog is not necessarily enabled for gameplay.',
    `CREDIT_FILE_COUNT: ${files.length}`,
  ].join('\n');
  const output = `${header}\n\n${sections.join('\n\n')}\n`;
  await writeFile(destination, output, 'utf8');
  return { files, output, outputPath: destination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateDungeonLpcCredits();
  console.log(`Generated ${path.relative(projectRoot, result.outputPath)} from ${result.files.length} credit files.`);
}
