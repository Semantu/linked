import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'docs', 'agents');
const skillsSourceDir = path.join(sourceDir, 'skills');
const targets = [
  {source: skillsSourceDir, dest: path.join(projectRoot, '.claude', 'skills')},
  {source: skillsSourceDir, dest: path.join(projectRoot, '.agents', 'skills')},
];

if (!existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

for (const {source, dest} of targets) {
  rmSync(dest, {recursive: true, force: true});
  mkdirSync(path.dirname(dest), {recursive: true});
  cpSync(source, dest, {recursive: true});
  console.log(`Synced ${source} -> ${dest}`);
}
