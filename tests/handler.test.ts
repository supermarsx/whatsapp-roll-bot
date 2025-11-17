import { getReplyForText } from '../src/handler'

describe('getReplyForText', () => {
  test('pong', () => {
    expect(getReplyForText('!ping')?.text).toBe('pong! 🏓')
  })

  test('marco', () => {
    expect(getReplyForText('!marco')?.text).toContain('polo')
  })

  test('roll command returns roll text', () => {
    const reply = getReplyForText('!d6')
    expect(reply).not.toBeNull()
    expect(reply!.text).toMatch(/You rolled a \*/)
  })

  test('non command', () => {
    expect(getReplyForText('hello')).toBeNull()
  })
})
