#!/usr/bin/env node

import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const skillsDir = path.join(projectRoot, 'packages', 'skills');
const skillsRepo = 'git@github.com:Semantu/agents.git';

function run(cmd, opts) {
  return execSync(cmd, {stdio: 'inherit', ...opts});
}

function setupSkills() {
  if (existsSync(path.join(skillsDir, '.git'))) {
    console.log('Updating skills repo...');
    run('git pull --ff-only', {cwd: skillsDir});
  } else {
    console.log('Cloning skills repo...');
    run(`git clone ${skillsRepo} ${skillsDir}`);
  }

  console.log('Syncing skills...');
  run('node sync.mjs', {cwd: skillsDir});
}

try {
  setupSkills();
} catch {
  console.log('\nSkipping skills setup — could not access the skills repo.');
  console.log('This is fine if you don\'t have access to github.com:Semantu/agents.');
}
