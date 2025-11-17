import { parseRollCommand, rollDice, isValidSides } from '../src/commands/roll'

describe('parseRollCommand', () => {
  test('parses !d20', () => {
    expect(parseRollCommand('!d20')).toBe(20)
  })

  test('parses !roll d100', () => {
    expect(parseRollCommand('!roll d100')).toBe(100)
  })

  test('returns null for non-command', () => {
    expect(parseRollCommand('hello')).toBeNull()
  })
})

describe('rollDice', () => {
  test('returns value between 1 and sides', () => {
    const r = rollDice(6, () => 0.5)
    expect(r).toBe(4) // floor(0.5 *6)+1 = 3+1 =4
  })

  test('throws on invalid sides', () => {
    expect(() => rollDice(0)).toThrow()
    expect(() => rollDice(-1)).toThrow()
    expect(() => rollDice(1.5)).toThrow()
  })
})

describe('isValidSides', () => {
  test('valid range default', () => {
    expect(isValidSides(2)).toBe(true)
    expect(isValidSides(100)).toBe(true)
    expect(isValidSides(101)).toBe(false)
    expect(isValidSides(1)).toBe(false)
  })
})
