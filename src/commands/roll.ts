/**
 * Parse a roll command from text. Supported commands:
 * - `!dN` e.g. `!d6`
 * - `!roll dN` e.g. `!roll d20`
 *
 * @param text - The incoming message text
 * @returns The parsed number of sides, or `null` if not a roll command.
 */
export function parseRollCommand(text: string): number | null {
  const match = text.trim().toLowerCase().match(/^!d(\d{1,3})$|^!roll\s+d(\d{1,3})$/)
  if (!match) return null
  const sides = parseInt(match[1] || match[2], 10)
  if (Number.isNaN(sides)) return null
  return sides
}

/**
 * Roll an N-sided die using the provided randomness source.
 *
 * @param sides - Number of sides on the die (must be a positive integer)
 * @param random - Optional RNG function returning [0,1) (defaults to Math.random)
 * @returns A roll result between 1 and `sides` inclusive.
 */
export function rollDice(sides: number, random = Math.random): number {
  if (!Number.isInteger(sides) || sides < 1) throw new Error('sides must be a positive integer')
  return Math.floor(random() * sides) + 1
}

/**
 * Validate that `sides` falls within allowed min/max bounds.
 *
 * @param sides - Number to validate
 * @param min - Minimum allowed sides (inclusive)
 * @param max - Maximum allowed sides (inclusive)
 */
export function isValidSides(sides: number, min = 2, max = 100): boolean {
  return Number.isInteger(sides) && sides >= min && sides <= max
}
