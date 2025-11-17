import EncryptedOtpStore from '../src/otpStore'

describe('EncryptedOtpStore jail and failures', () => {
  const store = new EncryptedOtpStore({ dataDir: 'data/tmp', otpTTL: 1, otpLength: 4 })

  test('records failures and jails after 3 failed attempts', async () => {
    await store.generate('bad@c.us')
    // wrong codes
    expect(await store.verify('bad@c.us', '0000')).toBe(false)
    expect(await store.verify('bad@c.us', '0000')).toBe(false)
    // third failure should jail
    const third = await store.verify('bad@c.us', '0000')
    expect(third).toBe(false)
    const jailed = Array.from(store._getJailed().values()).length > 0
    expect(jailed).toBe(true)
  })

  test('blocked while jailed', async () => {
    const res = await store.verify('bad@c.us', '0000')
    expect(res).toBe(false)
  })
})