'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildBackupFilename,
  listBackupFiles,
  pruneOldBackups,
} = require('../../scripts/backup-db');

describe('backup-db helpers', () => {
  const tmpDir = path.join(__dirname, '..', '..', 'data', 'test-backups');
  const dbPath = path.join(__dirname, '..', '..', 'data', 'sample.db');

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds timestamped backup filename', () => {
    const name = buildBackupFilename(dbPath, new Date('2026-04-09T12:34:56Z'));
    expect(name).toBe('sample-20260409-123456.sqlite');
  });

  it('lists only matching backup files', () => {
    fs.writeFileSync(path.join(tmpDir, 'sample-20260409-123000.sqlite'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'sample-20260409-124000.sqlite'), 'b');
    fs.writeFileSync(path.join(tmpDir, 'other-20260409-124000.sqlite'), 'c');

    const files = listBackupFiles(tmpDir, dbPath).map(f => path.basename(f));
    expect(files).toEqual([
      'sample-20260409-123000.sqlite',
      'sample-20260409-124000.sqlite',
    ]);
  });

  it('prunes old backups and keeps newest files', () => {
    const names = [
      'sample-20260409-120000.sqlite',
      'sample-20260409-121000.sqlite',
      'sample-20260409-122000.sqlite',
      'sample-20260409-123000.sqlite',
    ];
    names.forEach(name => fs.writeFileSync(path.join(tmpDir, name), name));

    const removed = pruneOldBackups(tmpDir, dbPath, 2).map(f => path.basename(f));
    const remaining = listBackupFiles(tmpDir, dbPath).map(f => path.basename(f));

    expect(removed).toEqual([
      'sample-20260409-120000.sqlite',
      'sample-20260409-121000.sqlite',
    ]);
    expect(remaining).toEqual([
      'sample-20260409-122000.sqlite',
      'sample-20260409-123000.sqlite',
    ]);
  });
});
