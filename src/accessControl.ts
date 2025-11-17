/**
 * Access control utilities: configurable whitelist/blacklist, admin lists,
 * and pairing passcode checks. Designed to be used synchronously with a
 * runtime configuration object (provided by the caller, e.g. bot.ts).
 */

export type AccessConfig = {
  whitelist?: {
    commands?: string[]
    groups?: string[]
    contacts?: string[]
  }
  blacklist?: {
    patterns?: string[]
    commands?: string[]
    groups?: string[]
    contacts?: string[]
  }
  pairing?: {
    passcode?: string
  }
  admin?: {
    admins?: string[]
    commands?: string[]
    whitelist?: {
      commands?: string[]
      groups?: string[]
      contacts?: string[]
    }
  }
}

/**
 * Create an access-control instance bound to the provided config.
 *
 * @param cfg - Partial runtime config for access controls.
 */
export default function createAccessControl(cfg?: AccessConfig) {
  const whitelist = cfg?.whitelist ?? {}
  const blacklist = cfg?.blacklist ?? {}
  const pairing = cfg?.pairing ?? {}
  const admin = cfg?.admin ?? {}

  const blacklistRegexes = (blacklist.patterns || []).map((p) => new RegExp(p, 'i'))

  function isContactWhitelisted(jid?: string): boolean {
    if (!jid) return false
    return (whitelist.contacts || []).includes(jid)
  }

  function isGroupWhitelisted(groupJid?: string): boolean {
    if (!groupJid) return false
    return (whitelist.groups || []).includes(groupJid)
  }

  function isContactBlacklisted(jid?: string): boolean {
    if (!jid) return false
    return (blacklist.contacts || []).includes(jid)
  }

  function isGroupBlacklisted(groupJid?: string): boolean {
    if (!groupJid) return false
    return (blacklist.groups || []).includes(groupJid)
  }

  function isTextBlacklisted(text?: string): boolean {
    if (!text) return false
    return blacklistRegexes.some((r) => r.test(text))
  }

  function isAdmin(jid?: string): boolean {
    if (!jid) return false
    return (admin.admins || []).includes(jid)
  }

  function isCommandWhitelisted(command?: string): boolean {
    if (!command) return false
    return (whitelist.commands || []).includes(command)
  }

  function isCommandBlacklisted(command?: string): boolean {
    if (!command) return false
    return (blacklist.commands || []).includes(command)
  }

  function isAdminCommandAllowed(command?: string, jid?: string): boolean {
    if (!command) return false
    // If admin.commands is specified, only those listed are admin commands
    const adminCmds = admin.commands || []
    if (adminCmds.length && !adminCmds.includes(command)) return false
    // If admin.whitelist exists, check it allows this admin command for this jid
    const aw = admin.whitelist
    if (!aw) return true
    if (aw.commands && aw.commands.includes(command)) return true
    if (aw.contacts && jid && aw.contacts.includes(jid)) return true
    return false
  }

  function checkPairingPasscode(entered?: string): boolean {
    if (!pairing.passcode) return true // not configured -> allow
    return Boolean(entered && entered === pairing.passcode)
  }

  /**
   * Decide if a given incoming message is allowed to be processed based on
   * contact/group membership and blacklist/whitelist patterns.
   */
  function isMessageAllowed(opts: { text?: string; from?: string; isGroup?: boolean; groupJid?: string }) {
    const { text, from, isGroup, groupJid } = opts
    // explicit contact blacklist wins
    if (isContactBlacklisted(from)) return false
    if (isGroup && isGroupBlacklisted(groupJid)) return false
    if (isTextBlacklisted(text)) return false

    // if whitelist is empty, default allow; otherwise require contact/group or command whitelist
    const hasAnyWhitelist = Boolean((whitelist.commands || []).length || (whitelist.contacts || []).length || (whitelist.groups || []).length)
    if (!hasAnyWhitelist) return true

    // If there's any whitelist, require match either by contact, group, or command present in text
    if (isContactWhitelisted(from)) return true
    if (isGroup && isGroupWhitelisted(groupJid)) return true
    // check if message starts with a whitelisted command
    const cmd = (text || '').trim().split(/\s+/)[0]
    if (isCommandWhitelisted(cmd)) return true

    return false
  }

  return {
    isContactWhitelisted,
    isGroupWhitelisted,
    isContactBlacklisted,
    isGroupBlacklisted,
    isTextBlacklisted,
    isAdmin,
    isCommandWhitelisted,
    isCommandBlacklisted,
    isAdminCommandAllowed,
    checkPairingPasscode,
    isMessageAllowed,
  }
}
