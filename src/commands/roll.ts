export function parseRollCommand(text: string): number | null {
  const match = text.trim().toLowerCase().match(/^!d(\d{1,3})$|^!roll\s+d(\d{1,3})$/)
  if (!match) return null
  const sides = parseInt(match[1] || match[2], 10)
  if (Number.isNaN(sides)) return null
  return sides
}

export function rollDice(sides: number, random = Math.random): number {
  if (!Number.isInteger(sides) || sides < 1) throw new Error('sides must be a positive integer')
  return Math.floor(random() * sides) + 1
}

export function isValidSides(sides: number, min = 2, max = 100): boolean {
  return Number.isInteger(sides) && sides >= min && sides <= max
}
