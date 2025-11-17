import EncryptedOtpStore from '../src/otpStore';
import fs from 'fs';
import crypto from 'crypto';

const tmpDir = 'data/tmp-otp-test';
const key = crypto.randomBytes(32).toString('hex');

describe('EncryptedOtpStore', () => {
  beforeAll(async () => {
    await fs.promises.mkdir(tmpDir, { recursive: true });
  });
  afterAll(async () => {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  test('generate, save, load, verify lifecycle', async () => {
    const store = new EncryptedOtpStore({ dataDir: tmpDir, keyHex: key, otpTTL: 60, otpLength: 4 });
    await store.load();
    const { code } = await store.generate('alice@c.us');
    expect(code).toHaveLength(4);
    // new instance should load the same code
    const store2 = new EncryptedOtpStore({
      dataDir: tmpDir,
      keyHex: key,
      otpTTL: 60,
      otpLength: 4,
    });
    const loaded = await store2.load();
    expect(loaded).toBe(true);
    // verify should succeed
    const ok = await store2.verify('alice@c.us', code);
    expect(ok).toBe(true);
  });

  test('cleanup removes expired entries', async () => {
    const shortStore = new EncryptedOtpStore({
      dataDir: tmpDir,
      keyHex: key,
      otpTTL: 1,
      otpLength: 3,
    });
    await shortStore.load();
    const { code } = await shortStore.generate('bob@c.us');
    expect(code).toHaveLength(3);
    // wait >1s
    await new Promise(r => setTimeout(r, 1200));
    const cleaned = await shortStore.cleanup();
    expect(cleaned).toBe(true);
    const ok = await shortStore.verify('bob@c.us', code);
    expect(ok).toBe(false);
  });
});
