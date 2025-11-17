import { parseRollCommand, rollDice, isValidSides } from './commands/roll'

/**
 * Simple reply payload used by `getReplyForText` to instruct the bot which
 * text to send back to the user.
 */
export type Reply = { text: string }

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
 * - `!dN` or `!roll dN` -> roll N-sided die and reply with the result
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
  if (trimmed.length === 0 || trimmed.length > 200) return null

  // reject suspicious messages early
  if (isSuspicious(trimmed)) return null

  const lower = trimmed.toLowerCase()

  // Strict exact-match checks for small commands
  if (/^!ping\s*$/i.test(lower)) return { text: 'pong! 🏓' }
  if (/^!marco\s*$/i.test(lower)) return { text: 'polo... ou seria Paulo? 🧲🎤' }

  // Delegate roll parsing to the command parser which already validates format
  const sides = parseRollCommand(trimmed)
  if (sides !== null && isValidSides(sides)) {
    const roll = rollDice(sides)
    return { text: `🎲 You rolled a *${roll}* on the d${sides}!` }
  }

  return null
}
