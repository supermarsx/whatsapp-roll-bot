/**
 * Main bot module
 *
 * This module initializes and runs the WhatsApp Roll Bot using the Baileys
 * library. It wires together configuration loading, access control, OTP
 * pairing, rate limiting, and message handlers that respond to simple
 * commands. The module also exposes helpers used by the CLI and tests to
 * inspect the in-memory store and to perform controlled shutdowns.
 *
 * Important exports:
 * - start(): initialize and run the bot
 * - shutdown(...): test-friendly shutdown wrapper
 * - getStoreSnapshot(): return chats/contacts snapshot for CLI/tests
 *
 * @module bot
 */

import { Boom } from '@hapi/boom';

// Module-level reference to the active socket to support CLI store inspection
let _sock: any = null;
import NodeCache from '@cacheable/node-cache';
import * as readline from 'readline';
import logger from './logger';
import createPinoCompatibleLogger from './pinoToWinston';
import createAccessControl from './accessControl';
import { generate } from 'ts-qrcode-terminal';
import * as adminHelpers from './admin';
import { enqueueLog } from './asyncLogger';
import { loggingQueue } from './queues';

/**
 * Start the WhatsApp roll bot.
 *
 * This boots Baileys with an adapter so its logs are forwarded into the
 * Winston application logger while keeping Baileys-compatible Pino API.
 *
 * The function performs the following high-level steps:
 * - Load runtime configuration from `config.json` (if present) and apply
 *   defaults for rate-limiting and paths.
 * - Ensure data/auth directories exist and start a log rotation monitor.
 * - Initialize OTP store and attach event handlers that log and optionally
 *   deliver webhooks for OTP lifecycle events.
 * - Create a Baileys socket, attach message handlers that enforce access
 *   control, rate-limiting and map simple commands to replies.
 * - Handle admin commands, pairing, OTP generation and delivery, and
 *   graceful shutdown orchestration.
 *
 * The function is designed to be run as the main application entrypoint and
 * will start a long-running event loop. It resolves once initialization
 * completes; the process will continue running until shutdown.
 *
 * @returns {Promise<void>} Promise that resolves when initialization completes.
 */
export async function start(): Promise<void> {
  type CacheStore = any;
  const msgRetryCounterCache: CacheStore = new NodeCache() as unknown as CacheStore;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (text: string) => new Promise<string>(resolve => rl.question(text, resolve));
  const usePairingCode = process.argv.includes('--use-pairing-code');
  const qrOnly = process.argv.includes('--qr-only');
  // session support: `--session name` will use authDir under sessionsBaseDir/name
  const sessionArgIndex = process.argv.indexOf('--session');
  const sessionName =
    sessionArgIndex >= 0 && process.argv[sessionArgIndex + 1]
      ? process.argv[sessionArgIndex + 1]
      : undefined;

  // Dynamically import Baileys to avoid loading the ESM package at module
  // parse time. This lets tests import this module without Jest choking
  // on ESM syntax.
  const baileys = await import('@whiskeysockets/baileys');
  const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeWASocket,
    makeCacheableSignalKeyStore,
    isJidNewsletter,
    DisconnectReason,
  } = baileys as any;

  // Load runtime config from project root `config.json` if present. This
  // allows adjusting rate-limits, paths and other runtime options without changing
  // source code. If the file is missing or invalid, fall back to defaults.
  const fs = await import('fs');
  type RuntimeConfig = {
    rateLimit?: {
      perSenderPerWindow?: number;
      globalPerWindow?: number;
      windowSeconds?: number;
    };
    paths?: {
      dataDir?: string;
      logsDir?: string;
      authDir?: string;
      sessionsBaseDir?: string;
    };
    logging?: {
      purgeLogsOnStartup?: boolean;
    };
    accessControl?: any;
  };

  const defaultConfig: Required<NonNullable<RuntimeConfig>> = {
    rateLimit: {
      perSenderPerWindow: 30,
      globalPerWindow: 500,
      windowSeconds: 60,
    },
    paths: {
      dataDir: 'data',
      logsDir: 'logs',
      authDir: 'auth',
      sessionsBaseDir: 'sessions',
    },
    logging: {
      purgeLogsOnStartup: false,
    },
    accessControl: {},
  };

  let runtimeConfig: Required<NonNullable<RuntimeConfig>> = defaultConfig;
  let parsedConfig: any = {};
  try {
    const cfgPath = 'config.json';
    if ((await fs.promises.stat(cfgPath)).isFile()) {
      const raw = await fs.promises.readFile(cfgPath, 'utf8');
      parsedConfig = JSON.parse(raw);
      runtimeConfig = {
        rateLimit: {
          perSenderPerWindow:
            parsedConfig?.rateLimit?.perSenderPerWindow ??
            defaultConfig.rateLimit.perSenderPerWindow,
          globalPerWindow:
            parsedConfig?.rateLimit?.globalPerWindow ?? defaultConfig.rateLimit.globalPerWindow,
          windowSeconds:
            parsedConfig?.rateLimit?.windowSeconds ?? defaultConfig.rateLimit.windowSeconds,
        },
        paths: {
          dataDir: parsedConfig?.paths?.dataDir ?? defaultConfig.paths.dataDir,
          logsDir: parsedConfig?.paths?.logsDir ?? defaultConfig.paths.logsDir,
          authDir: parsedConfig?.paths?.authDir ?? defaultConfig.paths.authDir,
          sessionsBaseDir:
            parsedConfig?.paths?.sessionsBaseDir ?? defaultConfig.paths.sessionsBaseDir,
        },
        logging: {
          purgeLogsOnStartup:
            parsedConfig?.logging?.purgeLogsOnStartup ?? defaultConfig.logging.purgeLogsOnStartup,
        },
        accessControl: parsedConfig?.accessControl ?? {},
      };
      enqueueLog('info', 'Loaded runtime config from config.json');
    }
  } catch (e) {
    // missing or invalid config — use defaults
    enqueueLog('info', 'Using default runtime config');
  }

  const { perSenderPerWindow, globalPerWindow, windowSeconds } = runtimeConfig.rateLimit;
  const dataDir = runtimeConfig.paths.dataDir ?? 'data';
  // choose auth dir based on sessionName when provided
  const sessionsBase = runtimeConfig.paths.sessionsBaseDir ?? 'sessions';
  const authDir = sessionName
    ? `${sessionsBase}/${sessionName}`
    : (runtimeConfig.paths.authDir ?? 'auth');
  const logsDir = runtimeConfig.paths.logsDir ?? 'logs';

  // start daily log rotation monitor (best-effort)
  try {
    const { startLogRotationMonitor } = await import('./logRotation');
    const _rotationHandle = startLogRotationMonitor(logsDir);
    // attach to graceful shutdown by closing the interval when shutdown occurs
    // the monitor exposes a `stop()` method which will be invoked in gracefulShutdown
    (global as any).__logRotationHandle = _rotationHandle;
  } catch (e) {
    enqueueLog(
      'warn',
      'Failed to start log rotation monitor: ' + ((e && (e as Error).message) || e),
    );
  }

  // ensure rate limit numeric values are available
  if (perSenderPerWindow == null || globalPerWindow == null || windowSeconds == null) {
    throw new Error('Invalid runtime configuration for rate limiting');
  }
  const perSender = Number(perSenderPerWindow);
  const globalPer = Number(globalPerWindow);
  const windowSec = Number(windowSeconds);

  // ensure data and auth directories exist
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.mkdir(authDir, { recursive: true });
  } catch (e) {
    enqueueLog(
      'warn',
      'Failed to ensure data/auth directories exist: ' + (e && (e as Error).message),
    );
  }

  // safe purge-on-startup: requires explicit env flag to actually delete files
  if (runtimeConfig.logging.purgeLogsOnStartup) {
    if (process.env.FORCE_PURGE_LOGS === '1') {
      try {
        const files = await fs.promises.readdir(logsDir);
        for (const f of files) {
          const fp = `${logsDir}/${f}`;
          try {
            const st = await fs.promises.stat(fp);
            if (st.isFile()) await fs.promises.unlink(fp);
          } catch (e) {
            enqueueLog('warn', `Failed to purge file ${fp}: ${(e && (e as Error).message) || e}`);
          }
        }
        enqueueLog('info', 'Purged logs directory on startup');
      } catch (e) {
        enqueueLog('warn', 'Failed to purge logs dir: ' + (e && (e as Error).message));
      }
    } else {
      logger.warn(
        'purgeLogsOnStartup is enabled in config.json but FORCE_PURGE_LOGS!=1, skipping destructive purge',
      );
    }
  }

  // instantiate access control helpers
  const accessControl = createAccessControl(parsedConfig?.accessControl);

  // pairing configuration and in-memory OTP store
  const pairingCfg = parsedConfig?.pairing || {};
  const adminChannel = parsedConfig?.admin?.adminChannel;
  const enforceAdminChannel = Boolean(parsedConfig?.admin?.enforceChannel);
  const silentFail =
    parsedConfig?.commands?.silentFail == null ? true : Boolean(parsedConfig?.commands?.silentFail);
  // Use EncryptedOtpStore to manage OTP persistence and lifecycle
  // Key is taken from env OTP_STORE_KEY or parsedConfig.pairing.otpStoreKey
  // If no key provided, store will operate in-memory.
  // Import the store implementation lazily to keep startup flexible in tests
  const { default: EncryptedOtpStore } = (await import('./otpStore')) as any;
  const keyHex = process.env.OTP_STORE_KEY || parsedConfig?.pairing?.otpStoreKey;
  const otpStoreClass = new EncryptedOtpStore({
    dataDir,
    keyHex,
    otpTTL: Number(pairingCfg?.otpTTLSeconds || 300),
    otpLength: Number(pairingCfg?.otpLength || 6),
    jailThreshold: Number(pairingCfg?.otpJailThreshold || 3),
    jailDurationSeconds: Number(pairingCfg?.otpJailDurationSeconds || 3600),
  });
  if (keyHex) await otpStoreClass.load();

  // Forward OTP-related events to logs and (optionally) to the pairing webhook
  async function deliverOtpEvent(eventName: string, payload: any) {
    try {
      const webhook = pairingCfg?.webhook || {};
      if (!webhook?.enabled || !webhook?.url) return { ok: false, reason: 'disabled' };
      const method = webhook.method || 'POST';
      const headers = webhook.headers || { 'Content-Type': 'application/json' };
      const body = JSON.stringify({ event: eventName, payload });
      const controller = new (globalThis as any).AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await (globalThis as any).fetch(webhook.url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        const ok = res && (res.status === 200 || res.status === 201 || res.status === 204);
        enqueueLog('info', `OTP event ${eventName} webhook ${ok ? 'succeeded' : 'failed'}`);
        return { ok };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      enqueueLog('warn', 'OTP event webhook delivery failed: ' + (e && (e as Error).message));
      return { ok: false, reason: e && (e as Error).message };
    }
  }

  otpStoreClass.on('generated', async (ev: any) => {
    logger.info(
      `OTP generated for ${ev.jid} (expires ${new Date(ev.expiresAt).toISOString()}, rng=${ev.rng})`,
    );
    void deliverOtpEvent('generated', ev);
  });
  otpStoreClass.on('verified', (ev: any) => {
    logger.info(`OTP verified for ${ev.jid}`);
    void deliverOtpEvent('verified', ev);
  });
  otpStoreClass.on('failed', (ev: any) => {
    logger.warn(`OTP failed for ${ev.jid}: ${ev.reason}`);
    void deliverOtpEvent('failed', ev);
  });
  otpStoreClass.on('jailed', (ev: any) => {
    logger.warn(`Jailed ${ev.jid} until ${new Date(ev.until).toISOString()}`);
    void deliverOtpEvent('jailed', ev);
  });
  otpStoreClass.on('expired', (ev: any) => {
    logger.info(`OTP expired for ${ev.jid}`);
    void deliverOtpEvent('expired', ev);
  });
  otpStoreClass.on('attemptWhileJailed', (ev: any) => {
    logger.warn(`Attempt while jailed ${ev.jid} until ${new Date(ev.until).toISOString()}`);
    void deliverOtpEvent('attemptWhileJailed', ev);
  });
  otpStoreClass.on('verifyBlocked', (ev: any) => {
    logger.warn(`Verify blocked for ${ev.jid} until ${new Date(ev.until).toISOString()}`);
    void deliverOtpEvent('verifyBlocked', ev);
  });
  otpStoreClass.on('deleted', (ev: any) => {
    logger.info(`OTP deleted for ${ev.jid} ok=${ev.ok}`);
    void deliverOtpEvent('deleted', ev);
  });

  async function deliverPairingWebhook(jid: string, code: string, expiresAt: number) {
    try {
      const webhook = pairingCfg?.webhook || {};
      if (!webhook?.enabled || !webhook?.url) return { ok: false, reason: 'disabled' };
      const method = webhook.method || 'POST';
      const headers = webhook.headers || { 'Content-Type': 'application/json' };
      const body = JSON.stringify({ jid, code, expiresAt });
      const controller = new (globalThis as any).AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await (globalThis as any).fetch(webhook.url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        const ok = res && (res.status === 200 || res.status === 201 || res.status === 204);
        logger.info(`Pairing webhook ${ok ? 'succeeded' : 'failed'} for ${jid} -> ${webhook.url}`);
        return { ok };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      logger.warn('Pairing webhook delivery failed: ' + (e && (e as Error).message));
      return { ok: false, reason: e && (e as Error).message };
    }
  }

  // Periodic cleanup of expired OTPs
  setInterval(() => {
    try {
      void otpStoreClass.cleanup();
    } catch (e) {
      enqueueLog('warn', 'Failed to cleanup OTP store: ' + (e && (e as Error).message));
    }
  }, 60 * 1000);

  // initialize Baileys auth & version info using configured authDir
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  enqueueLog('info', `using WA v${version.join('.')}, isLatest: ${isLatest}`);

  // keep a pino-compatible logger that forwards to Winston to unify logs
  const baileysLogger = createPinoCompatibleLogger(logger);

  // In-memory sliding-window rate limiter state
  const senderTimestamps: Map<string, number[]> = new Map();
  const globalTimestamps: number[] = [];

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  function pruneArray(arr: number[], cutoff: number) {
    while (arr.length && arr[0] < cutoff) arr.shift();
  }

  function isRateLimited(senderId: string): { limited: boolean; reason?: string } {
    const cutoff = nowSeconds() - windowSec;
    // global
    pruneArray(globalTimestamps, cutoff);
    if (globalTimestamps.length >= globalPer) return { limited: true, reason: 'global' };

    // per-sender
    const senderArr = senderTimestamps.get(senderId) || [];
    pruneArray(senderArr, cutoff);
    if (senderArr.length >= perSender) return { limited: true, reason: 'sender' };

    // record
    senderArr.push(nowSeconds());
    senderTimestamps.set(senderId, senderArr);
    globalTimestamps.push(nowSeconds());
    return { limited: false };
  }

  // Create the Baileys socket with the expected options
  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    printQRInTerminal: !usePairingCode,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    msgRetryCounterCache,
  });

  // store module-level reference so CLI can inspect when running
  _sock = sock;

  // register graceful shutdown handlers bound to this socket and readline
  const shutdownHandler = async (code = 0) => await gracefulShutdown(sock, rl, code);
  process.once('SIGINT', () => shutdownHandler(0));
  process.once('SIGTERM', () => shutdownHandler(0));

  // --- PAIRING CODE AUTH ---
  if (usePairingCode && !sock.authState.creds.registered) {
    const phoneNumber = await question(
      'Please enter your phone number (with country code, e.g. 351XXXXXXXXX):\n',
    );
    const code = await sock.requestPairingCode(phoneNumber);
    // if a pairing passcode is configured, require it before proceeding
    if (parsedConfig?.accessControl?.pairing?.passcode) {
      const entered = await question('Enter pairing passcode:\n');
      if (!accessControl.checkPairingPasscode(entered)) {
        enqueueLog('warn', 'Invalid pairing passcode provided, aborting startup');
        await gracefulShutdown(sock, rl, 1);
        return;
      }
    }
    enqueueLog('info', `Pairing code: ${code}`);
  }

  // --- CORE: REPLY TO "!dXX" ---
  const { getReplyForText } = await import('./handler');

  /**
   * Simple pre-filter to reject suspicious messages before they reach handlers.
   * This provides defense-in-depth in case handlers are ever changed to
   * interpolate message text into shell commands or other dangerous contexts.
   */
  const isSuspiciousIncoming = (text: string | undefined | null) => {
    if (!text) return true;
    if (text.length === 0 || text.length > 400) return true;
    const patterns: RegExp[] = [
      /https?:\/\//i,
      /[`$()<>;|&]/,
      /\b(?:wget|curl|exec|spawn|system|sh|bash|cmd|powershell|php|node|python|ruby|eval|require|child_process)\b/i,
    ];
    return patterns.some(p => p.test(text));
  };

  sock.ev.process(async (events: any) => {
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      if (qr && !usePairingCode) {
        enqueueLog('info', 'Scan this QR with WhatsApp:');
        generate(qr, {
          small: true,
          qrErrorCorrectLevel: 1, // adjust as needed
        });
        if (qrOnly) {
          // If user requested QR only, exit after showing QR
          await gracefulShutdown(sock, rl, 0);
        }
      }

      if (connection === 'close') {
        if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
          start();
        } else {
          enqueueLog('info', 'Connection closed. You are logged out.');
        }
      }
      if (connection === 'open') {
        enqueueLog('info', '✅ WhatsApp connected and ready!');
      }
    }

    if (events['creds.update']) await saveCreds();

    if (events['messages.upsert']) {
      const upsert = events['messages.upsert'];
      if (upsert.type === 'notify') {
        for (const msg of upsert.messages) {
          // ignore newsletters, system messages, and own messages
          if (!msg.message || msg.key.fromMe || isJidNewsletter(msg.key.remoteJid!)) continue;

          // read plain and extended text
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

          if (text && !isSuspiciousIncoming(text)) {
            const senderId = String(msg.key.participant || msg.key.remoteJid || 'unknown');

            // Access control: check whitelist/blacklist rules
            const isGroup = Boolean(msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us'));
            const groupJid = isGroup ? msg.key.remoteJid : undefined;
            if (!accessControl.isMessageAllowed({ text, from: senderId, isGroup, groupJid })) {
              enqueueLog('warn', `Message from ${senderId} rejected by access control`);
              continue;
            }

            // Rate-limit checks: per-sender and global
            const limited = isRateLimited(senderId);
            if (limited.limited) {
              enqueueLog(
                'warn',
                `Dropping message due to rate limit (${limited.reason}) from ${senderId}`,
              );
              continue;
            }

            const reply = getReplyForText(text);
            if (reply) {
              // special markers for admin actions
              if (
                reply.text === '!logout' ||
                reply.text === '!shutdown' ||
                reply.text === '!latency' ||
                reply.text.startsWith('!adminpair')
              ) {
                const cmd = reply.text;
                const senderJid = senderId;
                const isTrusted = accessControl.isTrustedNumber(senderJid);
                const isAdminUser =
                  accessControl.isAdmin(senderJid) &&
                  accessControl.isAdminCommandAllowed(cmd.split(':')[0], senderJid);

                // Enforce adminChannel if configured: admin commands must originate from that group
                if (
                  enforceAdminChannel &&
                  adminChannel &&
                  msg.key.remoteJid !== adminChannel &&
                  !isAdminUser
                ) {
                  logger.warn(
                    `Admin command ${cmd} rejected due to adminChannel enforcement. From ${msg.key.remoteJid}`,
                  );
                  if (!silentFail)
                    await sock.sendMessage(
                      msg.key.remoteJid!,
                      { text: `⛔ Admin commands are restricted to ${adminChannel}` },
                      { quoted: msg },
                    );
                  continue;
                }

                if (!isTrusted && !isAdminUser) {
                  logger.warn(`Rejected admin command ${cmd} from ${senderJid}`);
                  if (!silentFail)
                    await sock.sendMessage(
                      msg.key.remoteJid!,
                      { text: '⛔ You are not authorized to perform this command.' },
                      { quoted: msg },
                    );
                  continue;
                }

                // Acknowledgement
                await sock.sendMessage(
                  msg.key.remoteJid!,
                  { text: `✅ Executing admin command: ${cmd}` },
                  { quoted: msg },
                );

                // perform the requested action
                if (cmd === '!logout') {
                  try {
                    await sock.logout?.();
                    await sock.sendMessage(msg.key.remoteJid!, {
                      text: 'Logged out successfully.',
                    });
                  } catch (e) {
                    enqueueLog('warn', 'Logout failed: ' + (e && (e as Error).message));
                  }
                }
                if (cmd === '!shutdown') {
                  // graceful shutdown and exit
                  await gracefulShutdown(sock, rl, 0);
                }
                if (cmd === '!latency') {
                  // compute latency based on message timestamp if available
                  const msgTs =
                    (msg as any).messageTimestamp ||
                    (msg.message && (msg as any).message.timestamp) ||
                    0;
                  const latencyMs = msgTs ? Math.max(0, Date.now() - msgTs * 1000) : 0;
                  await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: `Latency: ~${latencyMs}ms` },
                    { quoted: msg },
                  );
                }
                if (cmd.startsWith('!adminpair')) {
                  const parts = cmd.split(':');
                  const provided = parts[1];
                  if (provided) {
                    // verify provided code: check accessControl passcode OR OTPs
                    const passOk = accessControl.checkPairingPasscode(provided);
                    const otpOk = await otpStoreClass.verify(senderJid, provided);
                    if (passOk || otpOk) {
                      await otpStoreClass.delete(senderJid);
                      // if adminChannel not set and message came from a group, auto-set admin channel
                      if (
                        !adminChannel &&
                        msg.key.remoteJid &&
                        msg.key.remoteJid.endsWith('@g.us')
                      ) {
                        try {
                          const cfgPath = 'config.json';
                          const ok = await adminHelpers.setAdminChannel(cfgPath, msg.key.remoteJid);
                          if (ok) {
                            await sock.sendMessage(msg.key.remoteJid!, {
                              text: `✅ Pairing accepted. This group (${msg.key.remoteJid}) is now configured as admin channel.`,
                            });
                            enqueueLog(
                              'info',
                              `Admin channel auto-configured to ${msg.key.remoteJid} by ${senderJid}`,
                            );
                          } else {
                            await sock.sendMessage(msg.key.remoteJid!, {
                              text: '✅ Pairing accepted, but failed to persist admin channel to config.',
                            });
                          }
                        } catch (e) {
                          enqueueLog(
                            'warn',
                            'Failed to persist adminChannel to config.json: ' +
                              (e && (e as Error).message),
                          );
                          await sock.sendMessage(msg.key.remoteJid!, {
                            text: '✅ Pairing accepted, but failed to persist admin channel to config.',
                          });
                        }
                      } else {
                        await sock.sendMessage(msg.key.remoteJid!, {
                          text: '✅ Pairing code accepted. Admin pairing complete.',
                        });
                      }
                    } else {
                      await sock.sendMessage(msg.key.remoteJid!, {
                        text: '❌ Invalid or expired pairing code.',
                      });
                    }
                  } else {
                    // no code provided — generate and deliver OTP if sender is trusted or admin
                    if (!isTrusted && !isAdminUser) {
                      await sock.sendMessage(msg.key.remoteJid!, {
                        text: 'Provide a pairing code or be a trusted number.',
                      });
                    } else {
                      // choose rng type from config if present
                      const rngType = pairingCfg?.rng || parsedConfig?.pairing?.rng || 'numeric';
                      try {
                        const { code, expiresAt } = await otpStoreClass.generate(senderJid, {
                          rngType: rngType,
                        });
                        // attempt webhook delivery (best-effort)
                        const wh = await deliverPairingWebhook(senderJid, code, expiresAt);
                        if (wh.ok) {
                          await sock.sendMessage(msg.key.remoteJid!, {
                            text: 'A pairing code has been delivered via webhook.',
                          });
                        } else {
                          // fallback: reveal code to sender if webhook disabled or failed but sender is trusted
                          if (isTrusted) {
                            await sock.sendMessage(msg.key.remoteJid!, {
                              text: `Pairing code: ${code}. Expires in ${Math.floor((expiresAt - Date.now()) / 1000)}s`,
                            });
                          } else {
                            if (!silentFail)
                              await sock.sendMessage(msg.key.remoteJid!, {
                                text: 'Pairing code generated. Webhook delivery attempted (disabled or failed). Contact an admin.',
                              });
                          }
                        }
                      } catch (e) {
                        enqueueLog(
                          'warn',
                          'Failed to generate pairing code: ' + (e && (e as Error).message),
                        );
                        await sock.sendMessage(msg.key.remoteJid!, {
                          text: `❌ Failed to generate pairing code: ${(e && (e as Error).message) || e}`,
                        });
                      }
                    }
                  }
                }
                if (cmd === '!setadmin') {
                  // Persist adminChannel if message came from a group
                  if (msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) {
                    try {
                      const cfgPath = 'config.json';
                      const ok = await adminHelpers.setAdminChannel(cfgPath, msg.key.remoteJid);
                      if (ok) {
                        await sock.sendMessage(msg.key.remoteJid!, {
                          text: `✅ This group (${msg.key.remoteJid}) has been configured as admin channel.`,
                        });
                      } else {
                        await sock.sendMessage(msg.key.remoteJid!, {
                          text: '❌ Failed to persist admin channel to config.',
                        });
                      }
                    } catch (e) {
                      enqueueLog(
                        'warn',
                        'Failed to persist adminChannel to config.json: ' +
                          (e && (e as Error).message),
                      );
                      await sock.sendMessage(msg.key.remoteJid!, {
                        text: '❌ Failed to persist admin channel to config.',
                      });
                    }
                  } else {
                    await sock.sendMessage(msg.key.remoteJid!, {
                      text: '❌ Admin channel must be set from a group chat.',
                    });
                  }
                }
                if (cmd === '!unsetadmin') {
                  try {
                    const cfgPath = 'config.json';
                    const ok = await adminHelpers.unsetAdminChannel(cfgPath);
                    if (ok) {
                      await sock.sendMessage(msg.key.remoteJid!, {
                        text: `✅ Admin channel unset.`,
                      });
                      enqueueLog('info', `Admin channel unset by ${senderJid}`);
                    } else {
                      await sock.sendMessage(msg.key.remoteJid!, {
                        text: '❌ Failed to update config.',
                      });
                    }
                  } catch (e) {
                    enqueueLog(
                      'warn',
                      'Failed to unset adminChannel in config.json: ' + (e && (e as Error).message),
                    );
                    await sock.sendMessage(msg.key.remoteJid!, {
                      text: '❌ Failed to update config.',
                    });
                  }
                }
                if (cmd === '!listjailed') {
                  try {
                    const jailed = adminHelpers.listJailed(otpStoreClass);
                    const lines = Object.entries(jailed).map(
                      ([j, until]) => `${j} -> ${new Date(Number(until)).toISOString()}`,
                    );
                    const body = lines.length ? lines.join('\n') : 'No jailed JIDs.';
                    await sock.sendMessage(msg.key.remoteJid!, {
                      text: `Jailed entries:\n${body}`,
                    });
                  } catch (e) {
                    enqueueLog('warn', 'Failed to list jailed: ' + (e && (e as Error).message));
                    await sock.sendMessage(msg.key.remoteJid!, {
                      text: '❌ Failed to list jailed entries.',
                    });
                  }
                }
                if (cmd.startsWith('!unjail')) {
                  const parts = cmd.split(':');
                  const target = parts[1];
                  if (!target) {
                    await sock.sendMessage(msg.key.remoteJid!, { text: 'Usage: !unjail <jid>' });
                  } else {
                    try {
                      const ok = await adminHelpers.unjail(otpStoreClass, target);
                      await sock.sendMessage(msg.key.remoteJid!, {
                        text: ok ? `✅ Unjailed ${target}` : `No jailed entry for ${target}`,
                      });
                    } catch (e) {
                      enqueueLog('warn', 'Failed to unjail: ' + (e && (e as Error).message));
                      await sock.sendMessage(msg.key.remoteJid!, {
                        text: '❌ Failed to unjail target.',
                      });
                    }
                  }
                }
                continue;
              }

              // rate-limit per-message by simple length check and ensure
              // outgoing messages are short to avoid abuse.
              if (reply.text && reply.text.length <= 1000) {
                await sock.sendMessage(msg.key.remoteJid!, { text: reply.text }, { quoted: msg });
              } else {
                enqueueLog('warn', 'Filtered outgoing reply due to excessive length');
              }
            }
          } else if (text) {
            enqueueLog('warn', 'Rejected suspicious or disallowed incoming message');
          }
        }
      }
    }
  });
}

/**
 * Gracefully shutdown the bot, attempting to logout, close readline, and
 * flush logger transports.
 *
 * @param sock - The Baileys socket instance (or compatible) with optional `logout` method.
 * @param rl - Readline interface to close.
 * @param exitCode - Process exit code (default: 0).
 */
async function gracefulShutdown(sock: any, rl: readline.Interface, exitCode = 0) {
  try {
    enqueueLog('info', 'Shutting down gracefully...');
    try {
      await sock.logout?.();
    } catch (e) {
      // ignore
    }
    try {
      rl.close();
    } catch (e) {
      // ignore
    }
    // Log that shutdown is complete before closing transports to avoid
    // write-after-end errors triggered by logging to closed streams.
    enqueueLog('info', 'Shutdown complete');
    // stop log rotation monitor if running
    try {
      const h = (global as any).__logRotationHandle;
      if (h && typeof h.stop === 'function') h.stop();
    } catch (e) {
      // ignore
    }

    // Wait for logging queue to drain so enqueued log writes complete.
    try {
      await (loggingQueue as any).drain?.();
    } catch (e) {
      // ignore
    }
    // Attempt to close the logger cleanly. Prefer the logger-level close
    // method if available; otherwise, fall back to closing individual
    // transports (best-effort and ignore errors).
    try {
      (logger as any).close?.();
    } catch (e) {
      for (const transport of (logger as any).transports || []) {
        try {
          transport.close?.();
        } catch (err) {
          // ignore
        }
      }
    }
  } catch (err) {
    enqueueLog('error', 'Error during graceful shutdown: ' + (err && (err as Error).message));
  } finally {
    // clear module-level reference
    try {
      _sock = null;
    } catch {}
    process.exit(exitCode);
  }
}

/**
 * Test-friendly shutdown wrapper that optionally skips exiting the process.
 *
 * @param sock - Baileys socket instance or compatible object.
 * @param rl - Readline interface.
 * @param options - Options object.
 * @param options.exitCode - Process exit code (default 0).
 * @param options.skipExit - If true, the process.exit call will be skipped (useful for tests).
 */
export async function shutdown(
  sock: any,
  rl: readline.Interface,
  options: { exitCode?: number; skipExit?: boolean } = {},
) {
  const { exitCode = 0, skipExit = false } = options;
  try {
    enqueueLog('info', 'Shutting down (wrapper)');
    try {
      await sock.logout?.();
    } catch (e) {
      // ignore
    }
    try {
      rl.close();
    } catch (e) {
      // ignore
    }
    // Log before closing transports to avoid logging to closed streams.
    enqueueLog('info', 'Shutdown wrapper complete');
    // Wait for logging queue to drain when available
    try {
      await (loggingQueue as any).drain?.();
    } catch (e) {
      // ignore
    }
    try {
      (logger as any).close?.();
    } catch (e) {
      for (const transport of (logger as any).transports || []) {
        try {
          transport.close?.();
        } catch (err) {
          // ignore
        }
      }
    }
  } catch (err) {
    enqueueLog('error', 'Error during shutdown wrapper: ' + (err && (err as Error).message));
  } finally {
    // clear module-level reference for CLI
    try {
      _sock = null;
    } catch {}
    if (!skipExit) process.exit(exitCode);
  }
}

/**
 * Provide a test/CLI-friendly snapshot of the in-memory store when the bot
 * is running. Returns null when no live socket/store is available.
 *
 * @returns {{chats:any,contacts:any}|null} Snapshot object or null if unavailable.
 */
export function getStoreSnapshot() {
  try {
    if (!_sock) return null;
    // Baileys stores may expose `store` with `chats` and `contacts`, or expose
    // `chats`/`contacts` directly on the socket depending on version.
    const chats = _sock.store?.chats || _sock.chats || {};
    const contacts = _sock.store?.contacts || _sock.contacts || {};
    return { chats, contacts };
  } catch (e) {
    return null;
  }
}
