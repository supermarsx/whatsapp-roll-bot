import { shutdown } from '../src/bot'

describe('shutdown wrapper', () => {
  test('calls logout and closes rl without exiting when skipExit=true', async () => {
    const called: string[] = []
    const sock = {
      logout: async () => {
        called.push('logout')
      },
    }
    const rl = {
      close: () => {
        called.push('rl.close')
      },
    } as any

    await shutdown(sock as any, rl as any, { skipExit: true })

    expect(called).toContain('logout')
    expect(called).toContain('rl.close')
  })
})
