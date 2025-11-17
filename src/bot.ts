import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import * as readline from 'readline'
import logger from './logger'
import createPinoCompatibleLogger from './pinoToWinston'
import createAccessControl from './accessControl'
import { generate } from 'ts-qrcode-terminal'

/**
 * Start the WhatsApp roll bot.
 *
 * This boots Baileys with an adapter so its logs are forwarded into the
 * Winston application logger while keeping Baileys-compatible Pino API.
 *
 * @returns Promise<void> that resolves when initialization completes.
 */
export async function start(): Promise<void> {
    type CacheStore = any
    const msgRetryCounterCache: CacheStore = new NodeCache() as unknown as CacheStore
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))
    const usePairingCode = process.argv.includes('--use-pairing-code')
    const qrOnly = process.argv.includes('--qr-only')

    // Dynamically import Baileys to avoid loading the ESM package at module
    // parse time. This lets tests import this module without Jest choking
    // on ESM syntax.
    const baileys = await import('@whiskeysockets/baileys')
    const {
        useMultiFileAuthState,
        fetchLatestBaileysVersion,
        makeWASocket,
        makeCacheableSignalKeyStore,
        isJidNewsletter,
        DisconnectReason,
    } = baileys as any

    // Load runtime config from project root `config.json` if present. This
    // allows adjusting rate-limits, paths and other runtime options without changing
    // source code. If the file is missing or invalid, fall back to defaults.
    const fs = await import('fs')
    type RuntimeConfig = {
        rateLimit?: {
            perSenderPerWindow?: number
            globalPerWindow?: number
            windowSeconds?: number
        }
        paths?: {
            dataDir?: string
            logsDir?: string
            authDir?: string
        }
        purge?: {
            purgeLogsOnStartup?: boolean
        }
        accessControl?: any
    }

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
        },
        purge: {
            purgeLogsOnStartup: false,
        },
        accessControl: {},
    }

    let runtimeConfig: Required<NonNullable<RuntimeConfig>> = defaultConfig
    let parsedConfig: any = {}
    try {
        const cfgPath = 'config.json'
        if ((await fs.promises.stat(cfgPath)).isFile()) {
            const raw = await fs.promises.readFile(cfgPath, 'utf8')
            parsedConfig = JSON.parse(raw)
            runtimeConfig = {
                rateLimit: {
                    perSenderPerWindow: parsedConfig?.rateLimit?.perSenderPerWindow ?? defaultConfig.rateLimit.perSenderPerWindow,
                    globalPerWindow: parsedConfig?.rateLimit?.globalPerWindow ?? defaultConfig.rateLimit.globalPerWindow,
                    windowSeconds: parsedConfig?.rateLimit?.windowSeconds ?? defaultConfig.rateLimit.windowSeconds,
                },
                paths: {
                    dataDir: parsedConfig?.paths?.dataDir ?? defaultConfig.paths.dataDir,
                    logsDir: parsedConfig?.paths?.logsDir ?? defaultConfig.paths.logsDir,
                    authDir: parsedConfig?.paths?.authDir ?? defaultConfig.paths.authDir,
                },
                purge: {
                    purgeLogsOnStartup: parsedConfig?.purge?.purgeLogsOnStartup ?? defaultConfig.purge.purgeLogsOnStartup,
                },
                accessControl: parsedConfig?.accessControl ?? {},
            }
            logger.info('Loaded runtime config from config.json')
        }
    } catch (e) {
        // missing or invalid config — use defaults
        logger.info('Using default runtime config')
    }

    const { perSenderPerWindow, globalPerWindow, windowSeconds } = runtimeConfig.rateLimit
    const dataDir = runtimeConfig.paths.dataDir ?? 'data'
    const authDir = runtimeConfig.paths.authDir ?? 'auth'
    const logsDir = runtimeConfig.paths.logsDir ?? 'logs'

    // ensure rate limit numeric values are available
    if (perSenderPerWindow == null || globalPerWindow == null || windowSeconds == null) {
        throw new Error('Invalid runtime configuration for rate limiting')
    }
    const perSender = Number(perSenderPerWindow)
    const globalPer = Number(globalPerWindow)
    const windowSec = Number(windowSeconds)

    // ensure data and auth directories exist
    try {
        await fs.promises.mkdir(dataDir, { recursive: true })
        await fs.promises.mkdir(authDir, { recursive: true })
    } catch (e) {
        logger.warn('Failed to ensure data/auth directories exist: ' + (e && (e as Error).message))
    }

    // safe purge-on-startup: requires explicit env flag to actually delete files
    if (runtimeConfig.purge.purgeLogsOnStartup) {
        if (process.env.FORCE_PURGE_LOGS === '1') {
            try {
                const files = await fs.promises.readdir(logsDir)
                for (const f of files) {
                    const fp = `${logsDir}/${f}`
                    try {
                        const st = await fs.promises.stat(fp)
                        if (st.isFile()) await fs.promises.unlink(fp)
                    } catch (e) {
                        logger.warn(`Failed to purge file ${fp}: ${(e && (e as Error).message) || e}`)
                    }
                }
                logger.info('Purged logs directory on startup')
            } catch (e) {
                logger.warn('Failed to purge logs dir: ' + (e && (e as Error).message))
            }
        } else {
            logger.warn('purgeLogsOnStartup is enabled in config.json but FORCE_PURGE_LOGS!=1, skipping destructive purge')
        }
    }

    // instantiate access control helpers
    const accessControl = createAccessControl(parsedConfig?.accessControl)

    // initialize Baileys auth & version info using configured authDir
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version, isLatest } = await fetchLatestBaileysVersion()
    logger.info(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    // keep a pino-compatible logger that forwards to Winston to unify logs
    const baileysLogger = createPinoCompatibleLogger(logger)

    // In-memory sliding-window rate limiter state
    const senderTimestamps: Map<string, number[]> = new Map()
    const globalTimestamps: number[] = []

    const nowSeconds = () => Math.floor(Date.now() / 1000)

    function pruneArray(arr: number[], cutoff: number) {
        while (arr.length && arr[0] < cutoff) arr.shift()
    }

    function isRateLimited(senderId: string): { limited: boolean; reason?: string } {
        const cutoff = nowSeconds() - windowSec
        // global
        pruneArray(globalTimestamps, cutoff)
        if (globalTimestamps.length >= globalPer) return { limited: true, reason: 'global' }

        // per-sender
        const senderArr = senderTimestamps.get(senderId) || []
        pruneArray(senderArr, cutoff)
        if (senderArr.length >= perSender) return { limited: true, reason: 'sender' }

        // record
        senderArr.push(nowSeconds())
        senderTimestamps.set(senderId, senderArr)
        globalTimestamps.push(nowSeconds())
        return { limited: false }
    }

    const sock = makeWASocket({
        version,
        logger: baileysLogger,
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        msgRetryCounterCache,
    })

    // register graceful shutdown handlers bound to this socket and readline
    const shutdownHandler = async (code = 0) => await gracefulShutdown(sock, rl, code)
    process.once('SIGINT', () => shutdownHandler(0))
    process.once('SIGTERM', () => shutdownHandler(0))

    // --- PAIRING CODE AUTH ---
    if (usePairingCode && !sock.authState.creds.registered) {
        const phoneNumber = await question('Please enter your phone number (with country code, e.g. 351XXXXXXXXX):\n')
        const code = await sock.requestPairingCode(phoneNumber)
        // if a pairing passcode is configured, require it before proceeding
        if (parsedConfig?.accessControl?.pairing?.passcode) {
            const entered = await question('Enter pairing passcode:\n')
            if (!accessControl.checkPairingPasscode(entered)) {
                logger.warn('Invalid pairing passcode provided, aborting startup')
                await gracefulShutdown(sock, rl, 1)
                return
            }
        }
        logger.info(`Pairing code: ${code}`)
    }

    // --- CORE: REPLY TO "!dXX" ---
    const { getReplyForText } = await import('./handler')

    /**
     * Simple pre-filter to reject suspicious messages before they reach handlers.
     * This provides defense-in-depth in case handlers are ever changed to
     * interpolate message text into shell commands or other dangerous contexts.
     */
    const isSuspiciousIncoming = (text: string | undefined | null) => {
        if (!text) return true
        if (text.length === 0 || text.length > 400) return true
        const patterns: RegExp[] = [
            /https?:\/\//i,
            /[`$()<>;|&]/,
            /\b(?:wget|curl|exec|spawn|system|sh|bash|cmd|powershell|php|node|python|ruby|eval|require|child_process)\b/i,
        ]
        return patterns.some((p) => p.test(text))
    }

    sock.ev.process(async (events: any) => {
        if (events['connection.update']) {
            const update = events['connection.update']
            const { connection, lastDisconnect, qr } = update

            if (qr && !usePairingCode) {
                logger.info('Scan this QR with WhatsApp:')
                generate(qr, {
                    small: true,
                    qrErrorCorrectLevel: 1, // adjust as needed
                })
                if (qrOnly) {
                    // If user requested QR only, exit after showing QR
                    await gracefulShutdown(sock, rl, 0)
                }
            }

            if (connection === 'close') {
                if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
                    start()
                } else {
                    logger.info('Connection closed. You are logged out.')
                }
            }
            if (connection === 'open') {
                logger.info('✅ WhatsApp connected and ready!')
            }

        }

        if (events['creds.update']) await saveCreds()

        if (events['messages.upsert']) {
            const upsert = events['messages.upsert']
            if (upsert.type === 'notify') {
                for (const msg of upsert.messages) {
                    // ignore newsletters, system messages, and own messages
                    if (!msg.message || msg.key.fromMe || isJidNewsletter(msg.key.remoteJid!)) continue

                    // read plain and extended text
                    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text

                    if (text && !isSuspiciousIncoming(text)) {
                        const senderId = String(msg.key.participant || msg.key.remoteJid || 'unknown')

                        // Access control: check whitelist/blacklist rules
                        const isGroup = Boolean(msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us'))
                        const groupJid = isGroup ? msg.key.remoteJid : undefined
                        if (!accessControl.isMessageAllowed({ text, from: senderId, isGroup, groupJid })) {
                            logger.warn(`Message from ${senderId} rejected by access control`) 
                            continue
                        }

                        // Rate-limit checks: per-sender and global
                        const limited = isRateLimited(senderId)
                        if (limited.limited) {
                            logger.warn(`Dropping message due to rate limit (${limited.reason}) from ${senderId}`)
                            continue
                        }

                        const reply = getReplyForText(text)
                        if (reply) {
                            // rate-limit per-message by simple length check and ensure
                            // outgoing messages are short to avoid abuse.
                            if (reply.text && reply.text.length <= 1000) {
                                await sock.sendMessage(msg.key.remoteJid!, { text: reply.text }, { quoted: msg })
                            } else {
                                logger.warn('Filtered outgoing reply due to excessive length')
                            }
                        }
                    } else if (text) {
                        logger.warn('Rejected suspicious or disallowed incoming message')
                    }
                }
            }
        }
    })
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
        logger.info('Shutting down gracefully...')
        try {
            await sock.logout?.()
        } catch (e) {
            // ignore
        }
        try {
            rl.close()
        } catch (e) {
            // ignore
        }
        // Log that shutdown is complete before closing transports to avoid
        // write-after-end errors triggered by logging to closed streams.
        logger.info('Shutdown complete')
        // Attempt to close the logger cleanly. Prefer the logger-level close
        // method if available; otherwise, fall back to closing individual
        // transports (best-effort and ignore errors).
        try {
            (logger as any).close?.()
        } catch (e) {
            for (const transport of (logger as any).transports || []) {
                try {
                    transport.close?.()
                } catch (err) {
                    // ignore
                }
            }
        }
    } catch (err) {
        console.error('Error during graceful shutdown', err)
    } finally {
        process.exit(exitCode)
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
    options: { exitCode?: number; skipExit?: boolean } = {}
) {
    const { exitCode = 0, skipExit = false } = options
    try {
        logger.info('Shutting down (wrapper)')
        try {
            await sock.logout?.()
        } catch (e) {
            // ignore
        }
        try {
            rl.close()
        } catch (e) {
            // ignore
        }
        // Log before closing transports to avoid logging to closed streams.
        logger.info('Shutdown wrapper complete')
        try {
            (logger as any).close?.()
        } catch (e) {
            for (const transport of (logger as any).transports || []) {
                try {
                    transport.close?.()
                } catch (err) {
                    // ignore
                }
            }
        }
    } catch (err) {
        console.error('Error during shutdown wrapper', err)
    } finally {
        if (!skipExit) process.exit(exitCode)
    }
}
