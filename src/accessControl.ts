/**
 * Access control utilities
 *
 * Provides a configurable factory that produces synchronous access-control
 * helpers based on a runtime configuration object. The produced instance
 * exposes predicates to check whitelist/blacklist membership, admin status,
 * pairing passcodes and whether an incoming message should be allowed.
 *
 * The intention is to keep policy checks deterministic and synchronous so
 * they can be used inline in message handling code.
 *
 * @module accessControl
 */

/**
 * Configuration shape for access controls.
 * @typedef {Object} AccessConfig
 * @property {'default'|'whitelist'|'blacklist'} [mode] - Mode controlling how whitelist/blacklist are applied.
 * @property {Object} [whitelist]
 * @property {string[]} [whitelist.commands]
 * @property {string[]} [whitelist.groups]
 * @property {string[]} [whitelist.contacts]
 * @property {string[]} [whitelist.prefixes]
 * @property {Object} [blacklist]
 * @property {string[]} [blacklist.patterns]
 * @property {string[]} [blacklist.commands]
 * @property {string[]} [blacklist.groups]
 * @property {string[]} [blacklist.contacts]
 * @property {string[]} [blacklist.prefixes]
 * @property {Object} [pairing]
 * @property {string} [pairing.passcode]
 * @property {string[]} [pairing.trustedNumbers]
 * @property {string[]} [pairing.prefixes]
 * @property {Object} [admin]
 * @property {string[]} [admin.admins]
 * @property {string[]} [admin.commands]
 * @property {Object} [admin.whitelist]
 * @property {string[]} [admin.whitelist.commands]
 * @property {string[]} [admin.whitelist.groups]
 * @property {string[]} [admin.whitelist.contacts]
 * @property {string[]} [admin.whitelist.prefixes]
 * @property {Object} [options]
 * @property {boolean} [options.allowPartialMatches]
 * @property {boolean} [options.disallowIndividuals]
 * @property {boolean} [options.disallowGroups]
 */
export type AccessConfig = {
  /**
   * Mode controls how whitelist/blacklist are applied:
   * - 'default' (fallback): existing behavior (whitelist optional)
   * - 'whitelist': require explicit whitelist entries to allow
   * - 'blacklist': deny only when blacklisted, ignore whitelist
   */
  mode?: 'default' | 'whitelist' | 'blacklist';
  whitelist?: {
    commands?: string[];
    groups?: string[];
    contacts?: string[];
    prefixes?: string[];
  };
  blacklist?: {
    patterns?: string[];
    commands?: string[];
    groups?: string[];
    contacts?: string[];
    prefixes?: string[];
  };
  pairing?: {
    passcode?: string;
    trustedNumbers?: string[];
    prefixes?: string[];
  };
  admin?: {
    admins?: string[];
    commands?: string[];
    whitelist?: {
      commands?: string[];
      groups?: string[];
      contacts?: string[];
      prefixes?: string[];
    };
  };
  options?: {
    allowPartialMatches?: boolean;
    disallowIndividuals?: boolean;
    disallowGroups?: boolean;
  };
};

/**
 * Create an access-control instance bound to the provided config.
 *
 * The returned object exposes synchronous predicate functions suitable for
 * inline checks in message handlers.
 *
 * @param {AccessConfig} [cfg] - Partial runtime config for access controls.
 * @returns {{
 *   isContactWhitelisted: (jid?: string)=>boolean,
 *   isGroupWhitelisted: (groupJid?: string)=>boolean,
 *   isContactBlacklisted: (jid?: string)=>boolean,
 *   isGroupBlacklisted: (groupJid?: string)=>boolean,
 *   isTextBlacklisted: (text?: string)=>boolean,
 *   isAdmin: (jid?: string)=>boolean,
 *   isCommandWhitelisted: (command?: string)=>boolean,
 *   isCommandBlacklisted: (command?: string)=>boolean,
 *   isAdminCommandAllowed: (command?: string, jid?: string)=>boolean,
 *   checkPairingPasscode: (entered?: string)=>boolean,
 *   isTrustedNumber: (jid?: string)=>boolean,
 *   isMessageAllowed: ({text?:string,from?:string,isGroup?:boolean,groupJid?:string})=>boolean
 * }} An object with access-check helper functions.
 */
export default function createAccessControl(cfg?: AccessConfig) {
  const whitelist = cfg?.whitelist ?? {};
  const blacklist = cfg?.blacklist ?? {};
  const pairing = cfg?.pairing ?? {};
  const admin = cfg?.admin ?? {};

  const blacklistRegexes = (blacklist.patterns || []).map(p => new RegExp(p, 'i'));
  const allowPartial = Boolean(cfg?.options?.allowPartialMatches);
  const disallowIndividuals = Boolean(cfg?.options?.disallowIndividuals);
  const disallowGroups = Boolean(cfg?.options?.disallowGroups);

  /**
   * Internal helper to match a list either by exact inclusion or partial
   * substring when allowPartialMatches option is enabled.
   * @private
   */
  function matchWithOption(list: string[] | undefined, value?: string) {
    if (!value || !list || list.length === 0) return false;
    if (allowPartial) return list.some(p => value.includes(p));
    return list.includes(value);
  }

  /**
   * Check whether a given value starts with any configured prefix.
   * @private
   */
  function matchPrefix(list: string[] | undefined, value?: string) {
    if (!value || !list || list.length === 0) return false;
    return list.some(p => value.startsWith(p));
  }

  /**
   * Return true when the contact jid explicitly matches whitelist.
   */
  function isContactWhitelisted(jid?: string): boolean {
    if (!jid) return false;
    return matchWithOption(whitelist.contacts, jid);
  }

  /**
   * Return true when the group jid explicitly matches whitelist.
   */
  function isGroupWhitelisted(groupJid?: string): boolean {
    if (!groupJid) return false;
    return matchWithOption(whitelist.groups, groupJid);
  }

  /**
   * Return true when the contact jid explicitly matches blacklist.
   */
  function isContactBlacklisted(jid?: string): boolean {
    if (!jid) return false;
    return matchWithOption(blacklist.contacts, jid);
  }

  /**
   * Return true when the group jid explicitly matches blacklist.
   */
  function isGroupBlacklisted(groupJid?: string): boolean {
    if (!groupJid) return false;
    return matchWithOption(blacklist.groups, groupJid);
  }

  /**
   * Return true when the incoming text matches any configured blacklist pattern.
   */
  function isTextBlacklisted(text?: string): boolean {
    if (!text) return false;
    return blacklistRegexes.some(r => r.test(text));
  }

  /**
   * Return true when the sender's JID matches any configured blacklist prefix.
   */
  function isPrefixBlacklisted(jid?: string) {
    return matchPrefix(blacklist.prefixes, jid);
  }

  /**
   * Return true when the JID is listed as an admin in configuration.
   */
  function isAdmin(jid?: string): boolean {
    if (!jid) return false;
    return matchWithOption(admin.admins || [], jid);
  }

  /**
   * Return true when the command is explicitly allowed by the whitelist.
   */
  function isCommandWhitelisted(command?: string): boolean {
    if (!command) return false;
    return (whitelist.commands || []).includes(command);
  }

  /**
   * Return true when the command is explicitly denied by the blacklist.
   */
  function isCommandBlacklisted(command?: string): boolean {
    if (!command) return false;
    return (blacklist.commands || []).includes(command);
  }

  /**
   * Determine whether an admin command is permitted for a given jid.
   * Respects configured admin.commands and admin.whitelist if present.
   */
  function isAdminCommandAllowed(command?: string, jid?: string): boolean {
    if (!command) return false;
    // If admin.commands is specified, only those listed are admin commands
    const adminCmds = admin.commands || [];
    if (adminCmds.length && !adminCmds.includes(command)) return false;
    // If admin.whitelist exists, check it allows this admin command for this jid
    const aw = admin.whitelist;
    if (!aw) return true;
    if (aw.commands && aw.commands.includes(command)) return true;
    if (
      (aw.contacts && jid && matchWithOption(aw.contacts, jid)) ||
      (aw.prefixes && jid && matchPrefix(aw.prefixes, jid))
    )
      return true;
    return false;
  }

  /**
   * Check the pairing passcode if configured. When no passcode is configured
   * pairing is considered allowed.
   */
  function checkPairingPasscode(entered?: string): boolean {
    if (!pairing.passcode) return true; // not configured -> allow
    return Boolean(entered && entered === pairing.passcode);
  }

  /**
   * Return true when a JID is considered trusted for pairing purposes.
   */
  function isTrustedNumber(jid?: string): boolean {
    if (!jid) return false;
    if (matchWithOption(pairing.trustedNumbers, jid)) return true;
    if (matchPrefix(pairing.prefixes, jid)) return true;
    return false;
  }

  /**
   * Decide if a given incoming message is allowed to be processed based on
   * contact/group membership and blacklist/whitelist patterns.
   *
   * @param {{text?:string, from?:string, isGroup?:boolean, groupJid?:string}} opts
   * @returns {boolean} True when the message is allowed, false otherwise.
   */
  function isMessageAllowed(opts: {
    text?: string;
    from?: string;
    isGroup?: boolean;
    groupJid?: string;
  }) {
    const { text, from, isGroup, groupJid } = opts;
    // Optionally disallow individuals or groups entirely
    if (disallowIndividuals && !isGroup) return false;
    if (disallowGroups && isGroup) return false;

    // Always honour explicit blacklist patterns first
    if (isContactBlacklisted(from) || isPrefixBlacklisted(from)) return false;
    if (isGroup && isGroupBlacklisted(groupJid)) return false;
    if (isTextBlacklisted(text)) return false;

    const mode = cfg?.mode || 'default';

    if (mode === 'blacklist') {
      // blacklist mode: deny only when blacklisted (handled above), otherwise allow
      return true;
    }

    // For whitelist mode, require an explicit whitelist match. For default, fall back to
    // previous behaviour where an empty whitelist means allow, otherwise require a match.
    const hasAnyWhitelist = Boolean(
      (whitelist.commands || []).length ||
        (whitelist.contacts || []).length ||
        (whitelist.groups || []).length ||
        (whitelist.prefixes || []).length,
    );

    if (mode === 'whitelist') {
      // If whitelist mode and no whitelist entries configured, deny by default
      if (!hasAnyWhitelist) return false;
      // require a whitelist match
      if (
        isContactWhitelisted(from) ||
        (whitelist.prefixes && matchPrefix(whitelist.prefixes, from))
      )
        return true;
      if (isGroup && isGroupWhitelisted(groupJid)) return true;
      const cmd = (text || '').trim().split(/\s+/)[0];
      if (isCommandWhitelisted(cmd)) return true;
      return false;
    }

    // default behaviour: if no whitelist configured, allow; otherwise require match
    if (!hasAnyWhitelist) return true;
    if (isContactWhitelisted(from) || (whitelist.prefixes && matchPrefix(whitelist.prefixes, from)))
      return true;
    if (isGroup && isGroupWhitelisted(groupJid)) return true;
    const cmd = (text || '').trim().split(/\s+/)[0];
    if (isCommandWhitelisted(cmd)) return true;
    return false;
  }

  return {
    /**
     * Check if the given contact JID is whitelisted.
     * @param {string} [jid] - The contact JID to check.
     * @returns {boolean} True if whitelisted, false otherwise.
     */
    isContactWhitelisted,

    /**
     * Check if the given group JID is whitelisted.
     * @param {string} [groupJid] - The group JID to check.
     * @returns {boolean} True if whitelisted, false otherwise.
     */
    isGroupWhitelisted,

    /**
     * Check if the given contact JID is blacklisted.
     * @param {string} [jid] - The contact JID to check.
     * @returns {boolean} True if blacklisted, false otherwise.
     */
    isContactBlacklisted,

    /**
     * Check if the given group JID is blacklisted.
     * @param {string} [groupJid] - The group JID to check.
     * @returns {boolean} True if blacklisted, false otherwise.
     */
    isGroupBlacklisted,

    /**
     * Check if the given text matches any blacklist pattern.
     * @param {string} [text] - The text to check.
     * @returns {boolean} True if blacklisted, false otherwise.
     */
    isTextBlacklisted,

    /**
     * Check if the given JID is an admin.
     * @param {string} [jid] - The JID to check.
     * @returns {boolean} True if admin, false otherwise.
     */
    isAdmin,

    /**
     * Check if the given command is whitelisted.
     * @param {string} [command] - The command to check.
     * @returns {boolean} True if whitelisted, false otherwise.
     */
    isCommandWhitelisted,

    /**
     * Check if the given command is blacklisted.
     * @param {string} [command] - The command to check.
     * @returns {boolean} True if blacklisted, false otherwise.
     */
    isCommandBlacklisted,

    /**
     * Check if an admin command is allowed for the given JID.
     * @param {string} [command] - The command to check.
     * @param {string} [jid] - The JID to check.
     * @returns {boolean} True if allowed, false otherwise.
     */
    isAdminCommandAllowed,

    /**
     * Check the pairing passcode.
     * @param {string} [entered] - The passcode entered by the user.
     * @returns {boolean} True if the passcode is correct, false otherwise.
     */
    checkPairingPasscode,

    /**
     * Check if the given JID is a trusted number for pairing.
     * @param {string} [jid] - The JID to check.
     * @returns {boolean} True if trusted, false otherwise.
     */
    isTrustedNumber,

    /**
     * Determine if an incoming message is allowed based on its attributes.
     * @param {{text?:string, from?:string, isGroup?:boolean, groupJid?:string}} opts - The message attributes.
     * @returns {boolean} True if the message is allowed, false otherwise.
     */
    isMessageAllowed,
  };
}
