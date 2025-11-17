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
    prefixes?: string[]
  }
  blacklist?: {
    patterns?: string[]
    commands?: string[]
    groups?: string[]
    contacts?: string[]
    prefixes?: string[]
  }
  pairing?: {
    passcode?: string
    trustedNumbers?: string[]
    prefixes?: string[]
  }
  admin?: {
    admins?: string[]
    commands?: string[]
    whitelist?: {
      commands?: string[]
      groups?: string[]
      contacts?: string[]
      prefixes?: string[]
    }
  }
  options?: {
    allowPartialMatches?: boolean
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
  const allowPartial = Boolean(cfg?.options?.allowPartialMatches)

  function matchWithOption(list: string[] | undefined, value?: string) {
    if (!value || !list || list.length === 0) return false
    if (allowPartial) return list.some((p) => value.includes(p))
    return list.includes(value)
  }

  function matchPrefix(list: string[] | undefined, value?: string) {
    if (!value || !list || list.length === 0) return false
    return list.some((p) => value.startsWith(p))
  }

  function isContactWhitelisted(jid?: string): boolean {
    if (!jid) return false
    return matchWithOption(whitelist.contacts, jid)
  }

  function isGroupWhitelisted(groupJid?: string): boolean {
    if (!groupJid) return false
    return matchWithOption(whitelist.groups, groupJid)
  }

  function isContactBlacklisted(jid?: string): boolean {
    if (!jid) return false
    return matchWithOption(blacklist.contacts, jid)
  }

  function isGroupBlacklisted(groupJid?: string): boolean {
    if (!groupJid) return false
    return matchWithOption(blacklist.groups, groupJid)
  }

  function isTextBlacklisted(text?: string): boolean {
    if (!text) return false
    return blacklistRegexes.some((r) => r.test(text))
  }

  function isPrefixBlacklisted(jid?: string) {
    return matchPrefix(blacklist.prefixes, jid)
  }

  function isAdmin(jid?: string): boolean {
    if (!jid) return false
    return matchWithOption(admin.admins || [], jid)
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
    if ((aw.contacts && jid && matchWithOption(aw.contacts, jid)) || (aw.prefixes && jid && matchPrefix(aw.prefixes, jid))) return true
    return false
  }

  function checkPairingPasscode(entered?: string): boolean {
    if (!pairing.passcode) return true // not configured -> allow
    return Boolean(entered && entered === pairing.passcode)
  }

  function isTrustedNumber(jid?: string): boolean {
    if (!jid) return false
    if (matchWithOption(pairing.trustedNumbers, jid)) return true
    if (matchPrefix(pairing.prefixes, jid)) return true
    return false
  }

  /**
   * Decide if a given incoming message is allowed to be processed based on
   * contact/group membership and blacklist/whitelist patterns.
   */
  function isMessageAllowed(opts: { text?: string; from?: string; isGroup?: boolean; groupJid?: string }) {
    const { text, from, isGroup, groupJid } = opts
    // explicit contact blacklist wins
    if (isContactBlacklisted(from) || isPrefixBlacklisted(from)) return false
    if (isGroup && isGroupBlacklisted(groupJid)) return false
    if (isTextBlacklisted(text)) return false

    // if whitelist is empty, default allow; otherwise require contact/group or command whitelist
    const hasAnyWhitelist = Boolean((whitelist.commands || []).length || (whitelist.contacts || []).length || (whitelist.groups || []).length || (whitelist.prefixes || []).length)
    if (!hasAnyWhitelist) return true

    // If there's any whitelist, require match either by contact, group, or command present in text
    if (isContactWhitelisted(from) || (whitelist.prefixes && matchPrefix(whitelist.prefixes, from))) return true
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
    isTrustedNumber,
    isMessageAllowed,
  }
}
