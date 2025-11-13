import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import * as readline from 'readline'
import makeWASocket, {
    AnyMessageContent,
    delay,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    proto,
    useMultiFileAuthState,
    WAMessageContent,
    WAMessageKey,
    isJidNewsletter
} from '@whiskeysockets/baileys'
import P from 'pino'
import { generate } from 'ts-qrcode-terminal'


const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
logger.level = 'info'

const msgRetryCounterCache = new NodeCache()
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))
const usePairingCode = process.argv.includes('--use-pairing-code')

const startSock = async () => {
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
            }

            if (connection === 'close') {
                if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
                    startSock()
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
						const statusMatch = text.trim().toLowerCase().match(/!ping$/);
						if (statusMatch) {
							await sock.sendMessage(
                                    msg.key.remoteJid!,
                                    { text: `pong! 🏓` },
                                    { quoted: msg }
                                )
						}
						
						const statusMatch1 = text.trim().toLowerCase().match(/!marco$/);
						if (statusMatch1) {
							await sock.sendMessage(
                                    msg.key.remoteJid!,
                                    { text: `polo... ou seria Paulo? 🧲🎤` },
                                    { quoted: msg }
                                )
						}
                        // Match !dX or !roll dX (e.g., !d20, !roll d100)
                        const match = text.trim().toLowerCase().match(/^!d(\d{1,3})$|^!roll\s+d(\d{1,3})$/)
                        if (match) {
                            const sides = parseInt(match[1] || match[2], 10)
                            if (sides >= 2 && sides <= 100) {
                                const roll = Math.floor(Math.random() * sides) + 1
                                await sock.sendMessage(
                                    msg.key.remoteJid!,
                                    { text: `🎲 You rolled a *${roll}* on the d${sides}!` },
                                    { quoted: msg }
                                )
                            }
                        }
                    }
                }
            }
        }
    })
}

startSock()
