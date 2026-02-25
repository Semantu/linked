import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'docs', 'agents');
const targets = [
  path.join(projectRoot, '.claude', 'agents'),
  path.join(projectRoot, '.agents', 'agents'),
];

if (!existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

for (const targetDir of targets) {
  rmSync(targetDir, {recursive: true, force: true});
  mkdirSync(path.dirname(targetDir), {recursive: true});
  cpSync(sourceDir, targetDir, {recursive: true});
  console.log(`Synced ${sourceDir} -> ${targetDir}`);
}
