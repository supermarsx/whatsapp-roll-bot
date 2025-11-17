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
import { generate } from 'ts-qrcode-terminal'

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
logger.level = 'info'

export async function start(): Promise<void> {
    const msgRetryCounterCache: CacheStore = new NodeCache() as unknown as CacheStore
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))
    const usePairingCode = process.argv.includes('--use-pairing-code')
    const qrOnly = process.argv.includes('--qr-only')

    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    const { version, isLatest } = await fetchLatestBaileysVersion()
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
    })

    // --- PAIRING CODE AUTH ---
    if (usePairingCode && !sock.authState.creds.registered) {
        const phoneNumber = await question('Please enter your phone number (with country code, e.g. 351XXXXXXXXX):\n')
        const code = await sock.requestPairingCode(phoneNumber)
        console.log(`Pairing code: ${code}`)
    }

    // --- CORE: REPLY TO "!dXX" ---
    const { getReplyForText } = await import('./handler')

    sock.ev.process(async (events) => {
        if (events['connection.update']) {
            const update = events['connection.update']
            const { connection, lastDisconnect, qr } = update

            if (qr && !usePairingCode) {
                console.log('Scan this QR with WhatsApp:')
                generate(qr, {
                    small: true,
                    qrErrorCorrectLevel: 1, // adjust as needed
                })
                if (qrOnly) {
                    // If user requested QR only, exit after showing QR
                    process.exit(0)
                }
            }

            if (connection === 'close') {
                if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
                    start()
                } else {
                    console.log('Connection closed. You are logged out.')
                }
            }
            if (connection === 'open') {
                console.log('✅ WhatsApp connected and ready!')
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
