import { parseRollCommand, rollDice, isValidSides } from './commands/roll'

/**
 * Message handler helpers
 *
 * This module contains utilities to parse incoming chat messages and map
 * them to simple text replies for supported commands (ping, marco, roll,
 * admin-management helpers, etc.). The implementation is intentionally
 * conservative: messages are validated and suspicious inputs rejected to
 * reduce risk if message text is re-used in other contexts.
 *
 * @module handler
 */

/**
 * Simple reply payload used by `getReplyForText` to instruct the bot which
 * text to send back to the user.
 *
 * @typedef {Object} Reply
 * @property {string} text - The message text to send as a reply.
 */
 export type Reply = { text: string }

/**
 * Parsed runtime configuration, if present. The code attempts to load
 * `config.json` from the current working directory. If the file is missing or
 * invalid the code falls back to defaults declared below.
 *
 * @type {any}
 */
 let runtimeCfg: any = {}
 try {
   // eslint-disable-next-line @typescript-eslint/no-var-requires
   const fs = require('fs')
   const cfgPath = 'config.json'
   if (fs.existsSync(cfgPath)) {
     const raw = fs.readFileSync(cfgPath, 'utf8')
     runtimeCfg = JSON.parse(raw)
   }
 } catch (e) {
   // ignore and rely on defaults below
 }

/**
 * Per-command enablement flags. Shape: { [commandName]: boolean }
 * Defaults enable common commands used by the bot.
 */
  const commandsEnabled = runtimeCfg?.commands?.enabled ?? { ping: true, marco: true, roll: true, logout: true, shutdown: true }

/**
 * Dice-related configuration controls allowed sides/rolls and whether
 * multiple-roll commands are permitted.
 */
  const diceCfg = runtimeCfg?.dice ?? { minSides: 2, maxSides: 100, allowMultipleRolls: false, maxRolls: 5 }

/**
 * RNG configuration. `method` may be 'math', 'crypto' or a seeded PRNG
 * like 'mulberry32'. `seed` is used only by seeded PRNG implementations.
 */
  const rngCfg = runtimeCfg?.rng ?? { method: 'math', seed: null }

  /**
   * Mapping of command names to short help descriptions used by `!help`.
   * @type {Record<string,string>}
   */
  const commandHelp: Record<string, string> = {
    ping: '!ping — simple liveness check (replies `pong! 🏓`)',
    marco: '!marco — cultural reference reply',
    roll: '!dN or !roll dN or !roll k dN — roll dice e.g. `!d20`, `!roll 3d6`',
    logout: '!logout — (admin) log the bot out of WhatsApp',
    shutdown: '!shutdown — (admin) gracefully shutdown the bot',
    help: '!help — show this help message',
  }


 /**
  * Build a random number generator function returning a uniform float in
  * the range [0, 1). The implementation supports a few methods:
  * - 'crypto': uses Node's crypto.randomInt for nondeterministic randomness
  * - 'mulberry32': a small seeded PRNG (deterministic given the same seed)
  * - default: Math.random()
  *
  * @param {string} method - RNG method name.
  * @param {*} seed - Optional seed used by seeded PRNGs.
  * @returns {() => number} Function that when called returns a float in [0,1).
  */
 function getRandomFunc(method: string, seed: any): (() => number) {
   if (method === 'crypto') {
     try {
       // use Node crypto.randomInt via wrapper to return [0,1)
       // eslint-disable-next-line @typescript-eslint/no-var-requires
       const crypto = require('crypto')
       return () => (crypto.randomInt(0, 1 << 30) / (1 << 30))
     } catch (e) {
       // fallback
       return Math.random
     }
   }
   if (method === 'mulberry32') {
     // simple seeded PRNG implementation
     const seedNum = Number(seed) || Date.now()
     let t = seedNum >>> 0
     return () => {
       t += 0x6D2B79F5
       let r = Math.imul(t ^ (t >>> 15), 1 | t)
       r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
       return ((r ^ (r >>> 14)) >>> 0) / 4294967296
     }
   }
   // default
   return Math.random
 }

 /**
  * Detect simple suspicious input patterns that could indicate attempts to
  * include shell commands, remote URLs or code that might lead to RCE if later
  * expanded into a runner. This is a conservative, best-effort check — keep in
  * mind it cannot replace secure coding practices but helps reduce attack
  * surface if the system is extended in future.
  *
  * @param text - The message text to inspect
  * @returns true if suspicious content detected
  */
 function isSuspicious(text: string): boolean {
   if (!text) return false
   // Reject very long messages early
   if (text.length > 500) return true

   const suspiciousRegexes: RegExp[] = [
     /[`$()<>;|&]/, // common shell metacharacters
     /\b(?:wget|curl|fetch|exec|spawn|system|sh|bash|cmd|powershell|php|node|python|ruby|eval|require|child_process|process\.env)\b/i,
     /https?:\/\//i, // URLs
     /(base64|data:text)\s*:/i, // embedded data blobs
   ]

   return suspiciousRegexes.some((r) => r.test(text))
 }

 /**
  * Convert an incoming message text into an optional reply. This function uses
  * a whitelist of allowed, simple commands and performs conservative input
  * filtering to reduce the risk of remote code execution if message text gets
  * used in other contexts later.
  *
  * Recognized commands (exact matches allowed):
  * - `!ping` -> `pong! 🏓`
  * - `!marco` -> `polo... ou seria Paulo? 🧲🎤`
  * - `!dN` or `!roll dN` or `!roll k dN` -> roll dice and reply with the result
  *
  * The function rejects messages that appear suspicious (URLs, shell metacharacters,
  * binary blobs) or are excessively long.
  *
  * @param text - The incoming message text
  * @returns A `Reply` object with the reply text, or `null` if no reply or the
  * message is disallowed.
  */
  export function getReplyForText(text: string): Reply | null {
   if (!text) return null
   const trimmed = text.trim()

   // quick length guard
   if (trimmed.length === 0 || trimmed.length > 500) return null

   // reject suspicious messages early
   if (isSuspicious(trimmed)) return null

   const lower = trimmed.toLowerCase()

    // Strict exact-match checks for small commands
    if (/^!ping\s*$/i.test(lower)) return commandsEnabled?.ping ? { text: 'pong! 🏓' } : null
    if (/^!marco\s*$/i.test(lower)) return commandsEnabled?.marco ? { text: 'polo... or was it Paulo? 🧲🎤' } : null

    // help command: build a message listing enabled commands
    if (/^!help\s*$/i.test(lower)) {
      const enabled = Object.entries(commandsEnabled).filter(([_, v]) => v).map(([k]) => k)
      const lines = enabled.map((c) => commandHelp[c] || c)
      return { text: `Available commands:\n${lines.join('\n')}` }
    }

    // admin test commands
    if (/^!latency\s*$/i.test(lower)) return commandsEnabled?.latency ? { text: '!latency' } : null
    const apMatch = trimmed.match(/^!adminpair(?:\s+(\S+))?$/i)
    if (apMatch) {
      const code = apMatch[1]
      return { text: code ? `!adminpair:${code}` : '!adminpair' }
    }

    // Admin management commands: set/unset admin channel and jail operations
    const setAdminMatch = trimmed.match(/^!setadmin\s*$/i)
    if (setAdminMatch) return { text: '!setadmin' }
    const unsetAdminMatch = trimmed.match(/^!unsetadmin\s*$/i)
    if (unsetAdminMatch) return { text: '!unsetadmin' }
    const listJailedMatch = trimmed.match(/^!listjailed\s*$/i)
    if (listJailedMatch) return { text: '!listjailed' }
    const unjailMatch = trimmed.match(/^!unjail\s+(\S+)$/i)
    if (unjailMatch) return { text: `!unjail:${unjailMatch[1]}` }

    // logout and shutdown commands are handled by bot.ts and must be enabled
    if (/^!logout\s*$/i.test(lower)) return commandsEnabled?.logout ? { text: '!logout' } : null
    if (/^!shutdown\s*$/i.test(lower)) return commandsEnabled?.shutdown ? { text: '!shutdown' } : null


   // Delegate roll parsing to the command parser which already validates format
   const parsed = parseRollCommand(trimmed)
   if (parsed !== null) {
     const { rolls, sides } = parsed
     // enforce dice config
     const minSides = Number(diceCfg.minSides || 2)
     const maxSides = Number(diceCfg.maxSides || 100)
     const allowMultiple = Boolean(diceCfg.allowMultipleRolls)
     const maxRolls = Number(diceCfg.maxRolls || 5)

     if (!isValidSides(sides, minSides, maxSides)) return null
     if (rolls > 1 && !allowMultiple) return null
     if (rolls > maxRolls) return null

     const rngFunc = getRandomFunc(rngCfg.method || 'math', rngCfg.seed)
     const results: number[] = []
     for (let i = 0; i < rolls; i++) {
       results.push(rollDice(sides, rngFunc))
     }
     const textRes = results.length === 1 ? `🎲 You rolled a *${results[0]}* on the d${sides}!` : `🎲 You rolled: ${results.join(', ')} (d${sides})`
     return { text: textRes }
   }

   return null
 }

