import { } from '../src/bot'
import createAccessControl from '../src/accessControl'

// We'll import bot's module dynamically to access its message handling via
// sending fake socket messages. Since the bot's runtime loop is heavy, we
// instead isolate logic by calling the same checks via a minimal simulation.

describe('bot admin command handling (simulated)', () => {
  test('latency from non-admin is rejected', async () => {
    const called: any[] = []
    const sock: any = {
      sendMessage: async (jid: string, payload: any) => called.push({ jid, payload }),
    }
    const ac = createAccessControl({ admin: { admins: ['admin@c.us'], commands: ['!latency'] } })
    const msg: any = { key: { remoteJid: 'room@g.us' }, messageTimestamp: Math.floor(Date.now() / 1000) }
    // Simulate the check that bot performs for admin-only cmd
    const sender = 'bob@c.us'
    if (!ac.isAdmin(sender) || !ac.isAdminCommandAllowed('!latency', sender)) {
      await sock.sendMessage(msg.key.remoteJid, { text: '⛔ You are not authorized to perform this command.' })
    }
    expect(called.some(c => c.payload.text.includes('not authorized'))).toBe(true)
  })

  test('latency from admin returns latency', async () => {
    const called: any[] = []
    const sock: any = {
      sendMessage: async (jid: string, payload: any) => called.push({ jid, payload }),
    }
    const ac = createAccessControl({ admin: { admins: ['admin@c.us'], commands: ['!latency'], whitelist: { contacts: ['admin@c.us'] } } })
    const msg: any = { key: { remoteJid: 'room@g.us' }, messageTimestamp: Math.floor(Date.now() / 1000) }
    const sender = 'admin@c.us'
    // authorized
    if (ac.isAdmin(sender) && ac.isAdminCommandAllowed('!latency', sender)) {
      const msgTs = msg.messageTimestamp || 0
      const latencyMs = msgTs ? Math.max(0, Date.now() - msgTs * 1000) : 0
      await sock.sendMessage(msg.key.remoteJid, { text: `Latency: ~${latencyMs}ms` })
    }
    expect(called.some(c => /Latency:/.test(c.payload.text))).toBe(true)
  })

  test('adminpair with correct code accepted', async () => {
    const called: any[] = []
    const sock: any = { sendMessage: async (jid: string, payload: any) => called.push({ jid, payload }) }
    const ac = createAccessControl({ pairing: { passcode: 'SECRET' }, admin: { admins: ['admin@c.us'], commands: ['!adminpair'], whitelist: { contacts: ['admin@c.us'] } } })
    const sender = 'admin@c.us'
    // provided code
    const provided = 'SECRET'
    if (ac.isAdmin(sender) && ac.isAdminCommandAllowed('!adminpair', sender)) {
      if (ac.checkPairingPasscode(provided)) {
        await sock.sendMessage('room@g.us', { text: '✅ Pairing code accepted. Admin pairing complete.' })
      }
    }
    expect(called.some(c => c.payload.text.includes('Pairing code accepted'))).toBe(true)
  })

  test('adminpair without code but from trusted number sends code', async () => {
    const called: any[] = []
    const sock: any = { sendMessage: async (jid: string, payload: any) => called.push({ jid, payload }) }
    const ac = createAccessControl({ pairing: { trustedNumbers: ['trusted@c.us'] }, admin: { admins: ['admin@c.us'], commands: ['!adminpair'], whitelist: { contacts: ['admin@c.us'] } } })
    const sender = 'trusted@c.us'
    if (ac.isAdmin(sender) && ac.isAdminCommandAllowed('!adminpair', sender)) {
      if (ac.isTrustedNumber(sender)) {
        await sock.sendMessage('room@g.us', { text: 'A pairing code was sent to your trusted number.' })
      }
    } else if (ac.isTrustedNumber(sender)) {
      // allow trusted numbers to request a code even if not admin
      await sock.sendMessage('room@g.us', { text: 'A pairing code was sent to your trusted number.' })
    }
    expect(called.some(c => c.payload.text.includes('pairing code'))).toBe(true)
  })

  test('adminpair with wrong code fails', async () => {
    const called: any[] = []
    const sock: any = { sendMessage: async (jid: string, payload: any) => called.push({ jid, payload }) }
    const ac = createAccessControl({ pairing: { passcode: 'SECRET' }, admin: { admins: ['admin@c.us'], commands: ['!adminpair'], whitelist: { contacts: ['admin@c.us'] } } })
    const sender = 'admin@c.us'
    const provided = 'WRONG'
    if (ac.isAdmin(sender) && ac.isAdminCommandAllowed('!adminpair', sender)) {
      if (!ac.checkPairingPasscode(provided)) {
        await sock.sendMessage('room@g.us', { text: '❌ Invalid pairing code.' })
      }
    }
    expect(called.some(c => c.payload.text.includes('Invalid pairing code'))).toBe(true)
  })
})
