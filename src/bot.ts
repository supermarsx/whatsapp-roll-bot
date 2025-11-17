import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import * as readline from 'readline'
import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    isJidNewsletter,
    CacheStore
} from '@whiskeysockets/baileys'
import P from 'pino'
import logger from './logger'
import { generate } from 'ts-qrcode-terminal'

export async function start(): Promise<void> {
    const msgRetryCounterCache: CacheStore = new NodeCache() as unknown as CacheStore
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))
    const usePairingCode = process.argv.includes('--use-pairing-code')
    const qrOnly = process.argv.includes('--qr-only')

    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    const { version, isLatest } = await fetchLatestBaileysVersion()
    logger.info(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    // keep a pino logger for Baileys to avoid compatibility issues
    const baileysLogger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
    baileysLogger.level = process.env.LOG_LEVEL || 'info'

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
        logger.info(`Pairing code: ${code}`)
    }

    // --- CORE: REPLY TO "!dXX" ---
    const { getReplyForText } = await import('./handler')

    sock.ev.process(async (events) => {
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

                    if (text) {
                        const reply = getReplyForText(text)
                        if (reply) {
                            await sock.sendMessage(msg.key.remoteJid!, { text: reply.text }, { quoted: msg })
                        }
                    }
                }
            }
        }
    })
}

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
        // flush Winston transports if necessary
        for (const transport of (logger as any).transports || []) {
            try {
                transport.close?.()
            } catch (e) {
                // ignore
            }
        }
        logger.info('Shutdown complete')
    } catch (err) {
        console.error('Error during graceful shutdown', err)
    } finally {
        process.exit(exitCode)
    }
}
