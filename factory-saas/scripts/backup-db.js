'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function buildBackupFilename(dbPath, now = new Date()) {
  const base = path.basename(dbPath, path.extname(dbPath));
  const stamp = [
    now.getUTCFullYear(),
    pad2(now.getUTCMonth() + 1),
    pad2(now.getUTCDate()),
    '-',
    pad2(now.getUTCHours()),
    pad2(now.getUTCMinutes()),
    pad2(now.getUTCSeconds()),
  ].join('');
  return `${base}-${stamp}.sqlite`;
}

function listBackupFiles(backupDir, dbPath) {
  const base = path.basename(dbPath, path.extname(dbPath));
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(name => name.startsWith(base + '-') && name.endsWith('.sqlite'))
    .map(name => path.join(backupDir, name))
    .sort();
}

function pruneOldBackups(backupDir, dbPath, keep = 7) {
  const files = listBackupFiles(backupDir, dbPath);
  const excess = Math.max(0, files.length - keep);
  const removed = [];
  for (let index = 0; index < excess; index += 1) {
    fs.unlinkSync(files[index]);
    removed.push(files[index]);
  }
  return removed;
}

async function runBackup({
  dbPath = config.db.path,
  backupDir = path.join(path.dirname(dbPath), 'backups'),
  keep = Number(process.env.DB_BACKUP_KEEP || 7),
  now = new Date(),
} = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB_NOT_FOUND: ${dbPath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, buildBackupFilename(dbPath, now));
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const removed = pruneOldBackups(backupDir, dbPath, keep);
  return { dest, removed };
}

async function main() {
  try {
    const result = await runBackup();
    console.log(`[backup] created: ${result.dest}`);
    if (result.removed.length) {
      console.log(`[backup] removed: ${result.removed.join(', ')}`);
    }
  } catch (err) {
    console.error('[backup] failed:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBackupFilename,
  listBackupFiles,
  pruneOldBackups,
  runBackup,
};
