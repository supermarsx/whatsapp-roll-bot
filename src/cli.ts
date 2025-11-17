#!/usr/bin/env node
import { readConfig } from './config';
import { listJailed, unjail, setAdminChannel, unsetAdminChannel } from './admin';
import EncryptedOtpStore from './otpStore';
import { startLogRotationMonitor } from './logRotation';
import { enqueueLog } from './asyncLogger';

async function loadOtpStore(parsedConfig: any) {
  const pairingCfg = parsedConfig?.pairing || {};
  const dataDir = parsedConfig?.paths?.dataDir || 'data';
  const keyHex = process.env.OTP_STORE_KEY || parsedConfig?.pairing?.otpStoreKey;
  const Encrypted = (EncryptedOtpStore as any) || null;
  if (!Encrypted) throw new Error('OTP store implementation not available');
  const instance = new Encrypted({
    dataDir,
    keyHex,
    otpTTL: 300,
    otpLength: 6,
    jailThreshold: 3,
    jailDurationSeconds: 3600,
  });
  if (keyHex) await instance.load();
  return instance;
}

function printUsage() {
  console.log('WhatsApp Roll Bot CLI');
  console.log('Usage: node dist/index.js <command> [args]');
  console.log('Commands:');
  console.log('  start                 Start the bot (same as node dist/bot.js)');
  console.log('  manage                Start the bot in management mode');
  console.log('  check-logs            Run log rotation checks once and exit');
  console.log('  purge-logs            Purge old rotated logs according to config or defaults');
  console.log('  list-jailed           Show jailed JIDs from OTP store');
  console.log('  unjail <jid>          Remove JID from jail');
  console.log('  set-admin <groupJid>  Persist admin channel to config.json');
  console.log('  unset-admin           Remove admin channel from config.json');
  console.log('  help                  Show this help');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
    printUsage();
    process.exit(0);
  }

  const cmd = argv[0];
  const cfgPath = 'config.json';
  const parsed = await readConfig(cfgPath);

  if (cmd === 'check-logs') {
    const logsDir = parsed?.paths?.logsDir || 'logs';
    const monitor = startLogRotationMonitor(logsDir, {
      retainDays: parsed?.logging?.retainDays || 14,
      webhookUrl: parsed?.logging?.webhookUrl,
    });
    // run a single check and exit
    if (monitor && typeof monitor.checkOnce === 'function') {
      try {
        await monitor.checkOnce();
      } catch (e) {
        enqueueLog('warn', 'CLI check-logs failed: ' + ((e && (e as Error).message) || e));
      }
    }
    process.exit(0);
  }

  if (cmd === 'purge-logs') {
    const logsDir = parsed?.paths?.logsDir || 'logs';
    const monitor = startLogRotationMonitor(logsDir, {
      retainDays: parsed?.logging?.retainDays || 14,
    });
    if (monitor && typeof monitor.purgeOldFiles === 'function') {
      const removed = await monitor.purgeOldFiles(logsDir);
      console.log(`Purged ${removed} files`);
    }
    process.exit(0);
  }

  if (cmd === 'list-jailed') {
    try {
      const otpStore = await loadOtpStore(parsed);
      const jailed = otpStore.listJailed();
      console.log('Jailed entries:');
      for (const [jid, until] of Object.entries(jailed)) {
        console.log(`${jid} -> ${new Date(Number(until)).toISOString()}`);
      }
      process.exit(0);
    } catch (e) {
      console.error('Failed to list jailed entries:', e);
      process.exit(1);
    }
  }

  if (cmd === 'unjail') {
    const target = argv[1];
    if (!target) {
      console.error('Usage: unjail <jid>');
      process.exit(2);
    }
    try {
      const otpStore = await loadOtpStore(parsed);
      const ok = await otpStore.unjail(target);
      console.log(ok ? `Unjailed ${target}` : `No jailed entry for ${target}`);
      process.exit(0);
    } catch (e) {
      console.error('Failed to unjail:', e);
      process.exit(1);
    }
  }

  if (cmd === 'set-admin') {
    const group = argv[1];
    if (!group) {
      console.error('Usage: set-admin <groupJid>');
      process.exit(2);
    }
    const ok = await setAdminChannel(cfgPath, group);
    process.exit(ok ? 0 : 1);
  }

  if (cmd === 'unset-admin') {
    const ok = await unsetAdminChannel(cfgPath);
    process.exit(ok ? 0 : 1);
  }

  if (cmd === 'start' || cmd === 'manage') {
    // Delegate to bot start for now
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const b = require('./bot') as any;
    if (cmd === 'manage') process.argv.push('--manage');
    b.start().catch((err: any) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const logger = require('./logger').default;
      logger.error('CLI start failed:', err);
      process.exit(1);
    });
    return;
  }

  console.error('Unknown command:', cmd);
  printUsage();
  process.exit(2);
}

main().catch(err => {
  console.error('CLI error:', err);
  process.exit(1);
});
