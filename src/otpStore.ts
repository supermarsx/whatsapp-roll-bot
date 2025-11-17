import fs from 'fs';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import logger from './logger';

const algorithm = 'aes-256-gcm';

/**
 * A single OTP entry stored in the encrypted store.
 * @typedef {Object} OtpEntry
 * @property {string} code - The one-time code string.
 * @property {number} expiresAt - Unix ms timestamp when the code expires.
 */
export type OtpEntry = { code: string; expiresAt: number };

/**
 * Supported random generator types for OTP generation.
 * - 'numeric' : numeric-only codes (zero-padded)
 * - 'alphanumeric' : human-friendly alphanumeric without ambiguous chars
 * - 'hex' : hex string
 * - 'mini-llm' : pronounceable token composed from syllables
 */
export type RngType = 'numeric' | 'alphanumeric' | 'hex' | 'mini-llm';

/**
 * EncryptedOtpStore
 *
 * A small, in-process OTP store that keeps entries in-memory and persists
 * them encrypted to disk when a 32-byte hex key (64 hex chars) is provided.
 * The class extends EventEmitter and emits events for lifecycle and security
 * related actions (see individual method docs for emitted events).
 *
 * Behaviour summary:
 * - If constructed without a valid `keyHex` the store operates purely in
 *   memory and will not persist OTPs to disk.
 * - OTPs have a TTL (seconds) after which they are expired and removed.
 * - The store tracks failed verification attempts per jid and will "jail"
 *   the jid for a configurable duration when the failure threshold is
 *   reached.
 *
 * Events emitted (examples):
 * - 'generated'   : { jid, code, expiresAt, rng }
 * - 'verified'    : { jid }
 * - 'failed'      : { jid, reason, details }
 * - 'expired'     : { jid }
 * - 'deleted'     : { jid, ok }
 * - 'jailed'      : { jid, until }
 * - 'unjailed'    : { jid }
 * - 'attemptWhileJailed' : { jid, until }
 * - 'verifyBlocked' : { jid, until }
 */
export default class EncryptedOtpStore extends EventEmitter {
  private otpFile: string;
  private keyHex?: string;
  private otpMap: Map<string, OtpEntry>;
  private otpTTL: number;
  private otpLength: number;
  private failures: Map<string, number>;
  private jailedUntil: Map<string, number>;
  private rngType: RngType;

  private jailThreshold: number;
  private jailDurationMs: number;

  /**
   * Create an EncryptedOtpStore instance.
   *
   * @param {Object} opts - Options.
   * @param {string} opts.dataDir - Directory to store encrypted OTP file (otpFile = `${dataDir}/otps.enc`).
   * @param {string} [opts.keyHex] - 64-hex char (32 byte) key used to encrypt the store. If omitted or invalid the store will be in-memory only.
   * @param {number} [opts.otpTTL=300] - Default TTL for generated OTPs in seconds.
   * @param {number} [opts.otpLength=6] - Default length of generated OTP codes.
   * @param {RngType} [opts.rngType='numeric'] - Default RNG type to use when generating codes.
   * @param {number} [opts.jailThreshold=3] - Number of consecutive failures that trigger jailing.
   * @param {number} [opts.jailDurationSeconds=3600] - Duration (seconds) a jid is jailed after threshold is reached.
   */
  constructor(opts: {
    dataDir: string;
    keyHex?: string;
    otpTTL?: number;
    otpLength?: number;
    rngType?: RngType;
    jailThreshold?: number;
    jailDurationSeconds?: number;
  }) {
    super();
    this.otpFile = `${opts.dataDir}/otps.enc`;
    this.keyHex = opts.keyHex;
    this.otpMap = new Map();
    this.otpTTL = opts.otpTTL || 300;
    this.otpLength = opts.otpLength || 6;
    this.failures = new Map();
    this.jailedUntil = new Map();
    this.rngType = opts.rngType || 'numeric';
    this.jailThreshold = opts.jailThreshold || 3;
    this.jailDurationMs = (opts.jailDurationSeconds || 3600) * 1000;

    // basic key validation
    if (this.keyHex && !/^[0-9a-fA-F]{64}$/.test(this.keyHex)) {
      // non-blocking logging
      try {
        // lazy import to avoid circulars in some test environments
        try {
          // use safeEnqueue synchronously when possible
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { safeEnqueue } = require('./asyncLogger');
          safeEnqueue(
            'warn',
            'OTP_STORE_KEY looks invalid: expected 64 hex chars (32 bytes). Falling back to in-memory store.',
          );
        } catch {
          logger.warn(
            'OTP_STORE_KEY looks invalid: expected 64 hex chars (32 bytes). Falling back to in-memory store.',
          );
        }
      } catch {
        logger.warn(
          'OTP_STORE_KEY looks invalid: expected 64 hex chars (32 bytes). Falling back to in-memory store.',
        );
      }
      this.keyHex = undefined;
    }
  }

  /**
   * Encrypt a plain object to a base64 string using AES-256-GCM.
   * @private
   * @param {*} obj - Object to encrypt (will be JSON.stringified).
   * @param {Buffer} key - 32-byte encryption key.
   * @returns {string} Base64 encoded ciphertext containing IV, auth tag and data.
   */
  private encryptObject(obj: any, key: Buffer) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, data]).toString('base64');
  }

  /**
   * Decrypt a base64 string produced by encryptObject.
   * @private
   * @param {string} b64 - Base64 encoded blob produced by encryptObject.
   * @param {Buffer} key - 32-byte encryption key.
   * @returns {*} The parsed object.
   */
  private decryptObject(b64: string, key: Buffer) {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const data = buf.slice(28);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  }

  /**
   * Load persisted state from disk into memory. Returns false if no key is
   * configured or if loading/decryption fails.
   *
   * @returns {Promise<boolean>} True if load succeeded, false otherwise.
   */
  async load() {
    if (!this.keyHex) return false;
    try {
      const key = Buffer.from(this.keyHex, 'hex');
      const raw = await fs.promises.readFile(this.otpFile, 'utf8');
      const obj = this.decryptObject(raw, key);
      this.otpMap.clear();
      for (const [k, v] of Object.entries(obj?.otps || {})) this.otpMap.set(k, v as OtpEntry);
      for (const [k, v] of Object.entries(obj?.failures || {})) this.failures.set(k, Number(v));
      for (const [k, v] of Object.entries(obj?.jailed || {})) this.jailedUntil.set(k, Number(v));
      return true;
    } catch (e) {
      try {
        try {
          // require & call safeEnqueue to avoid using async import in this path
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { safeEnqueue } = require('./asyncLogger');
          safeEnqueue('warn', 'Failed to load OTP store: ' + ((e && (e as Error).message) || e));
        } catch {
          logger.warn('Failed to load OTP store:', (e && (e as Error).message) || e);
        }
      } catch {
        logger.warn('Failed to load OTP store:', (e && (e as Error).message) || e);
      }
      return false;
    }
  }

  /**
   * Persist current in-memory state to disk encrypted with the configured key.
   * If no key is configured the function returns false.
   *
   * @returns {Promise<boolean>} True on success, false on failure.
   */
  async save() {
    if (!this.keyHex) return false;
    try {
      const key = Buffer.from(this.keyHex, 'hex');
      const obj: any = { otps: {}, failures: {}, jailed: {} };
      for (const [k, v] of this.otpMap.entries()) obj.otps[k] = v;
      for (const [k, v] of this.failures.entries()) obj.failures[k] = v;
      for (const [k, v] of this.jailedUntil.entries()) obj.jailed[k] = v;
      const enc = this.encryptObject(obj, key);
      await fs.promises.mkdir(require('path').dirname(this.otpFile), { recursive: true });
      await fs.promises.writeFile(this.otpFile, enc, 'utf8');
      return true;
    } catch (e) {
      try {
        try {
          // require & call safeEnqueue to avoid using async import in this path
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { safeEnqueue } = require('./asyncLogger');
          safeEnqueue('warn', 'Failed to save OTP store: ' + ((e && (e as Error).message) || e));
        } catch {
          logger.warn('Failed to save OTP store:', (e && (e as Error).message) || e);
        }
      } catch {
        logger.warn('Failed to save OTP store:', (e && (e as Error).message) || e);
      }
      return false;
    }
  }

  /**
   * Generate a numeric OTP of configured length (zero-padded).
   * @private
   * @returns {string}
   */
  private generateNumeric() {
    const max = Math.pow(10, this.otpLength);
    const num = crypto.randomInt(0, max);
    return String(num).padStart(this.otpLength, '0');
  }

  /**
   * Generate an alphanumeric OTP from a human-friendly character set.
   * @private
   * @returns {string}
   */
  private generateAlphanumeric() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < this.otpLength; i++) out += chars[crypto.randomInt(0, chars.length)];
    return out;
  }

  /**
   * Generate a hex OTP of configured length.
   * @private
   * @returns {string}
   */
  private generateHex() {
    return crypto
      .randomBytes(Math.ceil(this.otpLength / 2))
      .toString('hex')
      .slice(0, this.otpLength);
  }

  /**
   * Tiny pronounceable token generator used as a 'mini-llm' option.
   * @private
   * @returns {string}
   */
  private generateMiniLlm() {
    const syllables = ['ra', 'ne', 'lo', 'mi', 'sa', 'tu', 've', 'ka', 'zu', 'pi', 'on', 'el'];
    let out = '';
    while (out.length < this.otpLength) {
      out += syllables[crypto.randomInt(0, syllables.length)];
    }
    return out.slice(0, this.otpLength);
  }

  /**
   * Generate and store an OTP for a given jid.
   *
   * Emits 'generated' on success.
   *
   * @param {string} jid - The identifier the OTP is generated for.
   * @param {Object} [opts] - Optional settings.
   * @param {RngType} [opts.rngType] - Override the store's default rngType for this generation.
   * @returns {Promise<{code: string, expiresAt: number}>} The generated code and expiry timestamp.
   * @throws {Error} If `jid` is falsy or the jid is currently jailed.
   */
  async generate(jid: string, opts?: { rngType?: RngType }) {
    if (!jid) throw new Error('jid required');
    // don't allow generating if jailed
    const now = Date.now();
    const jailedUntil = this.jailedUntil.get(jid) || 0;
    if (jailedUntil > now) {
      this.emit('attemptWhileJailed', { jid, until: jailedUntil });
      throw new Error(`Jailed until ${new Date(jailedUntil).toISOString()}`);
    }

    const rng = opts?.rngType || this.rngType;
    let code = '';
    if (rng === 'numeric') code = this.generateNumeric();
    else if (rng === 'alphanumeric') code = this.generateAlphanumeric();
    else if (rng === 'hex') code = this.generateHex();
    else code = this.generateMiniLlm();

    const expiresAt = Date.now() + this.otpTTL * 1000;
    this.otpMap.set(jid, { code, expiresAt });
    await this.save();
    this.emit('generated', { jid, code, expiresAt, rng });
    return { code, expiresAt };
  }

  /**
   * Record a failed verification attempt for a jid and apply jailing policy
   * when configured thresholds are exceeded.
   * @private
   * @param {string} jid
   * @returns {{jailed: boolean, until?: number, attempts?: number}}
   */
  private recordFailure(jid: string) {
    const prev = this.failures.get(jid) || 0;
    const now = Date.now();
    const current = prev + 1;
    this.failures.set(jid, current);
    // apply configured jail threshold/duration
    if (current > 0 && current % this.jailThreshold === 0) {
      const until = now + this.jailDurationMs;
      this.jailedUntil.set(jid, until);
      this.failures.set(jid, 0);
      this.save().catch(() => {});
      this.emit('jailed', { jid, until });
      return { jailed: true, until };
    }
    this.save().catch(() => {});
    return { jailed: false, attempts: current };
  }

  /**
   * Verify a code for a given jid. Returns true on successful verification
   * and false otherwise. Successful verification removes the OTP and resets
   * failure counters.
   *
   * Emits 'verified', 'expired', 'failed', or 'verifyBlocked' depending on outcome.
   *
   * @param {string} jid
   * @param {string} code
   * @returns {Promise<boolean>} True if verified, false otherwise.
   */
  async verify(jid: string, code: string) {
    const now = Date.now();
    const jailedUntil = this.jailedUntil.get(jid) || 0;
    if (jailedUntil > now) {
      this.emit('verifyBlocked', { jid, until: jailedUntil });
      return false;
    }

    const entry = this.otpMap.get(jid);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.otpMap.delete(jid);
      await this.save();
      this.emit('expired', { jid });
      return false;
    }
    if (entry.code === code) {
      this.otpMap.delete(jid);
      this.failures.delete(jid);
      await this.save();
      this.emit('verified', { jid });
      return true;
    }
    const res = this.recordFailure(jid);
    this.emit('failed', { jid, reason: 'invalid', details: res });
    return false;
  }

  /**
   * Delete any stored OTP for a jid. Emits 'deleted'.
   *
   * @param {string} jid
   * @returns {Promise<boolean>} True if an entry was deleted, false otherwise.
   */
  async delete(jid: string) {
    const ok = this.otpMap.delete(jid);
    if (ok) await this.save();
    this.emit('deleted', { jid, ok });
    return ok;
  }

  /**
   * Cleanup expired OTPs and expired jails. Persists changes if any were made.
   *
   * @returns {Promise<boolean>} True if any OTPs were removed, otherwise false.
   */
  async cleanup() {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of Array.from(this.otpMap.entries())) {
      if (v.expiresAt <= now) {
        this.otpMap.delete(k);
        changed = true;
      }
    }
    // also clear expired jails
    for (const [k, v] of Array.from(this.jailedUntil.entries())) {
      if (v <= now) this.jailedUntil.delete(k);
    }
    if (changed) await this.save();
    return changed;
  }

  // test helper
  _getMap() {
    return this.otpMap;
  }

  _getFailures() {
    return this.failures;
  }

  _getJailed() {
    return this.jailedUntil;
  }

  /**
   * Return a plain object of currently jailed entries { jid: until }.
   * @returns {Record<string, number>}
   */
  listJailed() {
    const out: Record<string, number> = {};
    for (const [k, v] of this.jailedUntil.entries()) out[k] = v;
    return out;
  }

  /**
   * Remove a jid from the jail list (if present) and persist state.
   * Emits an `unjailed` event when successful.
   *
   * @param {string} jid
   * @returns {Promise<boolean>} True if jid was unjailed, false if it was not present.
   */
  async unjail(jid: string) {
    const had = this.jailedUntil.delete(jid);
    if (had) {
      try {
        await this.save();
      } catch (e) {
        // ignore
      }
      this.emit('unjailed', { jid });
    }
    return had;
  }
}
