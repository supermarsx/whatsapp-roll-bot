#!/usr/bin/env node
import './polyfills';
import { readConfig } from './config';
import { setAdminChannel, unsetAdminChannel } from './admin';
import EncryptedOtpStore from './otpStore';
import { startLogRotationMonitor } from './logRotation';
import { enqueueLog } from './asyncLogger';

/**
 * Command-line interface utilities
 *
 * This module implements a small CLI for management tasks (log checks,
 * OTP store inspection, admin channel management, and booting the bot in
 * management mode). The CLI is intentionally lightweight and delegates
 * most functionality to library modules so the same code paths are used
 * by the running application.
 *
 * @module cli
 */

/**
 * Load and return an EncryptedOtpStore instance configured from runtime
 * configuration. If a key is available the store will attempt to load
 * persisted state from disk.
 *
 * @param {any} parsedConfig - Parsed configuration object (typically from config.json)
 * @returns {Promise<EncryptedOtpStore>} An initialized OTP store instance.
 * @throws When the OTP store implementation is not available.
 */
async function loadOtpStore(parsedConfig: any) {
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

/**
 * Print usage information for the CLI to stdout.
 * This function is synchronous and intended for interactive use.
 *
 * @returns {void}
 */
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
  console.log('  list-groups           List known groups (jid -> subject)');
  console.log('  list-contacts         List known contacts (jid -> name)');
  console.log('  help, -h, --help      Show this help');
}

/**
 * Execute a CLI command.
 *
 * The function reads `config.json`, dispatches the requested command and
 * returns an exit code suitable for `process.exit`. Commands include log
 * maintenance utilities, OTP store inspection/manipulation and delegating to
 * the bot for start/manage actions.
 *
 * @param {string[]} argv - Array of CLI arguments (typically `process.argv.slice(2)`).
 * @returns {Promise<number>} Exit code (0 = success, non-zero = error).
 */
export async function runCLI(argv: string[]) {
  const args = argv || [];
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return 0;
  }

  const cmd = args[0];
  const cfgPath = 'config.json';
  const parsed = await readConfig(cfgPath);

  // Management commands (starting/controlling the bot) can be disabled via
  // config.json under the `cli.managementEnabled` boolean key. Default is
  // enabled (true) when the key is missing.
  const managementEnabled = parsed?.cli?.managementEnabled !== false;

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
        try {
          monitor.stop();
        } catch {}
        return 1;
      }
    }
    try {
      monitor.stop();
    } catch {}
    return 0;
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
    try {
      monitor.stop();
    } catch {}
    return 0;
  }

  if (cmd === 'list-jailed') {
    try {
      const otpStore = await loadOtpStore(parsed);
      const jailed = otpStore.listJailed();
      console.log('Jailed entries:');
      for (const [jid, until] of Object.entries(jailed)) {
        console.log(`${jid} -> ${new Date(Number(until)).toISOString()}`);
      }
      return 0;
    } catch (e) {
      console.error('Failed to list jailed entries:', e);
      return 1;
    }
  }

  if (cmd === 'unjail') {
    const target = args[1];
    if (!target) {
      console.error('Usage: unjail <jid>');
      return 2;
    }
    try {
      const otpStore = await loadOtpStore(parsed);
      const ok = await otpStore.unjail(target);
      console.log(ok ? `Unjailed ${target}` : `No jailed entry for ${target}`);
      return 0;
    } catch (e) {
      console.error('Failed to unjail:', e);
      return 1;
    }
  }

  if (cmd === 'set-admin') {
    const group = args[1];
    if (!group) {
      console.error('Usage: set-admin <groupJid>');
      return 2;
    }
    const ok = await setAdminChannel(cfgPath, group);
    return ok ? 0 : 1;
  }

  if (cmd === 'unset-admin') {
    const ok = await unsetAdminChannel(cfgPath);
    return ok ? 0 : 1;
  }

  if (cmd === 'list-groups' || cmd === 'list-contacts') {
    // Try to use the running bot's store if possible by requiring './bot'
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const b = require('./bot') as any;
      // The bot module may expose a `getStoreSnapshot` helper in future. If present, use it.
      const storeSnapshot = b.getStoreSnapshot?.() || (b as any).storeSnapshot?.() || null;
      const which = cmd === 'list-groups' ? 'groups' : 'contacts';
      if (storeSnapshot) {
        if (which === 'groups') {
          const chats = storeSnapshot.chats || {};
          const lines: string[] = [];
          for (const [jid, meta] of Object.entries(chats)) {
            // only group jids typically end with @g.us
            if (!jid.endsWith('@g.us')) continue;
            const subject = (meta as any).subject || (meta as any).name || '';
            lines.push(`${jid} -> ${subject}`);
          }
          if (lines.length) console.log(lines.join('\n'));
          else console.log('No groups available');
          return 0;
        } else {
          const contacts = storeSnapshot.contacts || {};
          const lines: string[] = [];
          for (const [jid, meta] of Object.entries(contacts)) {
            const name = (meta as any).name || (meta as any).notify || '';
            lines.push(`${jid} -> ${name}`);
          }
          if (lines.length) console.log(lines.join('\n'));
          else console.log('No contacts available');
          return 0;
        }
      }
    } catch (e) {
      // fallthrough to helpful message below
    }
    console.error(
      'No running bot store found. Start the bot and try again, or extend the CLI to load a session.',
    );
    return 2;
  }

  if (cmd === 'start' || cmd === 'manage') {
    if (!managementEnabled) {
      console.error(
        'CLI management commands are disabled by configuration (cli.managementEnabled=false)',
      );
      return 2;
    }
    // Delegate to bot start for now
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const b = require('./bot') as any;
    if (cmd === 'manage') process.argv.push('--manage');
    b.start().catch((err: any) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const logger = require('./logger').default;
      logger.error('CLI start failed:', err);
      // don't exit here; return non-zero code
    });
    return 0;
  }

  console.error('Unknown command:', cmd);
  printUsage();
  return 2;
}

/**
 * Small wrapper to execute the CLI when the module is run directly.
 * Exits the process with the returned exit code.
 */
async function main() {
  try {
    const code = await runCLI(process.argv.slice(2));
    process.exit(code);
  } catch (err) {
    console.error('CLI error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
