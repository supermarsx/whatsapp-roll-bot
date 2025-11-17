import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { startLogRotationMonitor } from '../src/logRotation';

jest.useRealTimers();

describe('logRotation monitor', () => {
  const tmpDir = path.join(__dirname, 'tmp-logs');
  let monitor: any | null = null;

  beforeEach(async () => {
    if (fsSync.existsSync(tmpDir)) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    if (monitor && typeof monitor.stop === 'function') {
      monitor.stop();
      monitor = null;
    }
    if (fsSync.existsSync(tmpDir)) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('detects missing today file and purges old files', async () => {
    // create an old file to be purged
    const oldMs = Date.now() - 20 * 24 * 60 * 60 * 1000;
    const oldDate = new Date(oldMs).toISOString().slice(0, 10);
    const oldName = `application-${oldDate}.log`;
    const oldPath = path.join(tmpDir, oldName);
    await fs.writeFile(oldPath, 'old');
    // set mtime to old timestamp so purge logic removes it
    await fs.utimes(oldPath, new Date(oldMs), new Date(oldMs));

    // create a recent file but not today's
    const recentMs = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const recentDate = new Date(recentMs).toISOString().slice(0, 10);
    const recentName = `application-${recentDate}.log`;
    await fs.writeFile(path.join(tmpDir, recentName), 'recent');

    monitor = startLogRotationMonitor(tmpDir, { retainDays: 7 });

    // run a check once and ensure purge happened
    await monitor.checkOnce();

    const files = await fs.readdir(tmpDir);
    expect(files).not.toContain(oldName);
  });
});
