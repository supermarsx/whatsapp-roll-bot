/**
 * Dice rolling command helpers
 *
 * This module contains small utilities to parse textual dice roll commands
 * (e.g. `!d20`, `!roll 3d6`) and to produce random die rolls using a
 * configurable RNG function. The parser intentionally accepts a limited
 *, well-defined grammar to keep behavior predictable and safe.
 *
 * Supported command forms:
 * - `!dN` e.g. `!d6`
 * - `!roll dN` e.g. `!roll d20`
 * - `!roll k dN` e.g. `!roll 3d6` or `!roll 3 d6`
 *
 * @module commands/roll
 */

/**
 * Parse a roll command from text. Supported commands:
 * - `!dN` e.g. `!d6`
 * - `!roll dN` e.g. `!roll d20`
 * - `!roll k dN` e.g. `!roll 3d6` or `!roll 3 d6`
 *
 * Examples:
 * ```js
 * parseRollCommand('!d20') // -> { rolls: 1, sides: 20 }
 * parseRollCommand('3d6')  // -> { rolls: 3, sides: 6 }
 * parseRollCommand('hello') // -> null
 * ```
 *
 * @param {string} text - The incoming message text
 * @returns {{rolls:number,sides:number}|null} The parsed number of rolls and sides, or `null` if not a roll command.
 */
 export function parseRollCommand(text: string): { rolls: number; sides: number } | null {
   const t = text.trim().toLowerCase()
   // Try formats: 3d6, !d6, !roll d6, !roll 3d6, !roll 3 d6
   let m = t.match(/^!d(\d{1,4})$/) || t.match(/^!roll\s+d(\d{1,4})$/)
   if (m) {
     const sides = parseInt(m[1], 10)
     return { rolls: 1, sides }
   }
   m = t.match(/^!(?:roll)\s+(\d{1,3})d(\d{1,4})$/) || t.match(/^(\d{1,3})d(\d{1,4})$/)
   if (m) {
     const rolls = parseInt(m[1], 10)
     const sides = parseInt(m[2], 10)
     return { rolls, sides }
   }
   m = t.match(/^!roll\s+(\d{1,3})\s+d(\d{1,4})$/)
   if (m) {
     const rolls = parseInt(m[1], 10)
     const sides = parseInt(m[2], 10)
     return { rolls, sides }
   }
   return null
 }

 /**
  * Roll an N-sided die using the provided randomness source.
  *
  * The `random` argument should be a function returning a floating point
  * number in the range [0, 1). By default `Math.random` is used. The
  * result is an integer in the inclusive range [1, sides].
  *
  * @param {number} sides - Number of sides on the die (must be a positive integer)
  * @param {() => number} [random=Math.random] - Optional RNG function returning [0,1) (defaults to Math.random)
  * @returns {number} A roll result between 1 and `sides` inclusive.
  * @throws {Error} If `sides` is not a positive integer.
  */
 export function rollDice(sides: number, random = Math.random): number {
   if (!Number.isInteger(sides) || sides < 1) throw new Error('sides must be a positive integer')
   return Math.floor(random() * sides) + 1
 }

 /**
  * Validate that `sides` falls within allowed min/max bounds.
  *
  * @param {number} sides - Number to validate
  * @param {number} [min=2] - Minimum allowed sides (inclusive)
  * @param {number} [max=100] - Maximum allowed sides (inclusive)
  * @returns {boolean} True when `sides` is an integer within [min, max]
  */
 export function isValidSides(sides: number, min = 2, max = 100): boolean {
   return Number.isInteger(sides) && sides >= min && sides <= max
 }

