import { parseRollCommand, rollDice, isValidSides } from './commands/roll'

export type Reply = { text: string }

export function getReplyForText(text: string): Reply | null {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (lower.match(/!ping$/)) return { text: 'pong! 🏓' }
  if (lower.match(/!marco$/)) return { text: 'polo... ou seria Paulo? 🧲🎤' }

  const sides = parseRollCommand(trimmed)
  if (sides !== null && isValidSides(sides)) {
    const roll = rollDice(sides)
    return { text: `🎲 You rolled a *${roll}* on the d${sides}!` }
  }

  return null
}
