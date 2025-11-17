import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { runCLI as importedRunCLI } from '../src/cli';

describe('CLI', () => {
  const cfgPath = path.join(process.cwd(), 'config.json');
  const backupCfg = fsSync.existsSync(cfgPath) ? fsSync.readFileSync(cfgPath, 'utf8') : null;

  afterAll(() => {
    if (backupCfg !== null) fsSync.writeFileSync(cfgPath, backupCfg, 'utf8');
  });

  test('help flag prints usage and returns 0', async () => {
    const rc = await importedRunCLI(['-h']);
    expect(rc).toBe(0);
  });

  test('unknown command returns non-zero', async () => {
    const rc = await importedRunCLI(['no-such-cmd']);
    expect(rc).toBe(2);
  });

  test('purge-logs on empty config returns 0', async () => {
    // ensure config.json exists minimal
    const minimal = { paths: { logsDir: 'tests/tmp-logs' }, logging: { retainDays: 7 } };
    await fs.writeFile(cfgPath, JSON.stringify(minimal, null, 2), 'utf8');
    const tmpDir = path.join(process.cwd(), 'tests', 'tmp-logs');
    if (fsSync.existsSync(tmpDir)) await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });

    const rc = await importedRunCLI(['purge-logs']);
    expect(rc).toBe(0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('list-groups uses running bot store', async () => {
    const snapshot = {
      chats: {
        '111@g.us': { subject: 'Group One' },
        '222@g.us': { subject: 'Another Group' },
        '333@s.whatsapp.net': { name: 'NotAGroup' },
      },
    } as any;

    jest.resetModules();
    jest.doMock('../src/bot', () => ({ getStoreSnapshot: () => snapshot }));
    const { runCLI } = require('../src/cli');

    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const rc = await runCLI(['list-groups']);
    expect(rc).toBe(0);
    expect(log).toHaveBeenCalled();
    const out = log.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(out).toContain('111@g.us -> Group One');
    expect(out).toContain('222@g.us -> Another Group');
    expect(out).not.toContain('333@s.whatsapp.net');

    log.mockRestore();
    err.mockRestore();
  });

  test('list-contacts uses running bot store', async () => {
    const snapshot = {
      contacts: {
        'alice@s.whatsapp.net': { name: 'Alice' },
        'bob@s.whatsapp.net': { notify: 'Bobby' },
      },
    } as any;

    jest.resetModules();
    jest.doMock('../src/bot', () => ({ getStoreSnapshot: () => snapshot }));
    const { runCLI } = require('../src/cli');

    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const rc = await runCLI(['list-contacts']);
    expect(rc).toBe(0);
    expect(log).toHaveBeenCalled();
    const out = log.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(out).toContain('alice@s.whatsapp.net -> Alice');
    expect(out).toContain('bob@s.whatsapp.net -> Bobby');

    log.mockRestore();
    err.mockRestore();
  });

  test('start/manage disabled by config', async () => {
    // write config with management disabled
    const disabled = { cli: { managementEnabled: false } };
    await fs.writeFile(cfgPath, JSON.stringify(disabled, null, 2), 'utf8');

    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const rc = await importedRunCLI(['start']);
    expect(rc).toBe(2);
    expect(err).toHaveBeenCalledWith(
      'CLI management commands are disabled by configuration (cli.managementEnabled=false)',
    );
    err.mockRestore();
  });

  test('start allowed by default and delegates to bot.start', async () => {
    // remove config key to use default (enabled)
    await fs.writeFile(cfgPath, JSON.stringify({}, null, 2), 'utf8');

    jest.resetModules();
    const mockStart = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../src/bot', () => ({ start: mockStart }));
    const { runCLI } = require('../src/cli');

    const rc = await runCLI(['start']);
    expect(rc).toBe(0);
    expect(mockStart).toHaveBeenCalled();
  });

  test('list-groups fallback when no running bot present', async () => {
    jest.resetModules();
    // Simulate requiring the bot module failing
    jest.doMock('../src/bot', () => {
      throw new Error('Cannot find module');
    });
    const { runCLI } = require('../src/cli');

    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const rc = await runCLI(['list-groups']);
    expect(rc).toBe(2);
    expect(err.mock.calls.some(c => c.join(' ').includes('No running bot store found'))).toBe(true);
    err.mockRestore();
  });

  test('list-contacts fallback when no running bot present', async () => {
    jest.resetModules();
    // Simulate requiring the bot module failing
    jest.doMock('../src/bot', () => {
      throw new Error('Cannot find module');
    });
    const { runCLI } = require('../src/cli');

    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const rc = await runCLI(['list-contacts']);
    expect(rc).toBe(2);
    expect(err.mock.calls.some(c => c.join(' ').includes('No running bot store found'))).toBe(true);
    err.mockRestore();
  });
});
