#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/backup.js <file> [more files]');
  process.exit(2);
}

const root = process.cwd();
const backupRoot = path.join(root, '.vibebackups');
ensureDirSync(backupRoot);

const indexPath = path.join(backupRoot, 'index.json');
let index = {};
try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (e) { index = {}; }

args.forEach((f) => {
  const abs = path.resolve(root, f);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', f);
    return;
  }

  const rel = path.relative(root, abs).replace(/\\/g, '/');
  const destDir = path.join(backupRoot, path.dirname(rel));
  ensureDirSync(destDir);

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const base = path.basename(rel);
  const destName = `${base}.${timestamp}.bak`;
  const dest = path.join(destDir, destName);

  fs.copyFileSync(abs, dest);

  if (!index[rel]) index[rel] = [];
  index[rel].push({ file: path.relative(root, dest).replace(/\\/g, '/'), time: new Date().toISOString() });
  console.log('Backed up', rel, '→', path.relative(root, dest));
});

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
console.log('Backup index updated at', path.relative(root, indexPath));
