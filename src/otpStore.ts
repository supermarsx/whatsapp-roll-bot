import fs from 'fs'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import logger from './logger'

const algorithm = 'aes-256-gcm'

export type OtpEntry = { code: string; expiresAt: number }

export type RngType = 'numeric' | 'alphanumeric' | 'hex' | 'mini-llm'

export default class EncryptedOtpStore extends EventEmitter {
  private otpFile: string
  private keyHex?: string
  private otpMap: Map<string, OtpEntry>
  private otpTTL: number
  private otpLength: number
  private failures: Map<string, number>
  private jailedUntil: Map<string, number>
  private rngType: RngType

  private jailThreshold: number
  private jailDurationMs: number

  constructor(opts: { dataDir: string; keyHex?: string; otpTTL?: number; otpLength?: number; rngType?: RngType; jailThreshold?: number; jailDurationSeconds?: number }) {
    super()
    this.otpFile = `${opts.dataDir}/otps.enc`
    this.keyHex = opts.keyHex
    this.otpMap = new Map()
    this.otpTTL = opts.otpTTL || 300
    this.otpLength = opts.otpLength || 6
    this.failures = new Map()
    this.jailedUntil = new Map()
    this.rngType = opts.rngType || 'numeric'
    this.jailThreshold = opts.jailThreshold || 3
    this.jailDurationMs = (opts.jailDurationSeconds || 3600) * 1000

    // basic key validation
    if (this.keyHex && !/^[0-9a-fA-F]{64}$/.test(this.keyHex)) {
      logger.warn('OTP_STORE_KEY looks invalid: expected 64 hex chars (32 bytes). Falling back to in-memory store.')
      this.keyHex = undefined
    }
  }

  private encryptObject(obj: any, key: Buffer) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(algorithm, key, iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, data]).toString('base64')
  }

  private decryptObject(b64: string, key: Buffer) {
    const buf = Buffer.from(b64, 'base64')
    const iv = buf.slice(0, 12)
    const tag = buf.slice(12, 28)
    const data = buf.slice(28)
    const decipher = crypto.createDecipheriv(algorithm, key, iv)
    decipher.setAuthTag(tag)
    const out = Buffer.concat([decipher.update(data), decipher.final()])
    return JSON.parse(out.toString('utf8'))
  }

  async load() {
    if (!this.keyHex) return false
    try {
      const key = Buffer.from(this.keyHex, 'hex')
      const raw = await fs.promises.readFile(this.otpFile, 'utf8')
      const obj = this.decryptObject(raw, key)
      this.otpMap.clear()
      for (const [k, v] of Object.entries(obj?.otps || {})) this.otpMap.set(k, v as OtpEntry)
      for (const [k, v] of Object.entries(obj?.failures || {})) this.failures.set(k, Number(v))
      for (const [k, v] of Object.entries(obj?.jailed || {})) this.jailedUntil.set(k, Number(v))
      return true
    } catch (e) {
      logger.warn('Failed to load OTP store:', (e && (e as Error).message) || e)
      return false
    }
  }

  async save() {
    if (!this.keyHex) return false
    try {
      const key = Buffer.from(this.keyHex, 'hex')
      const obj: any = { otps: {}, failures: {}, jailed: {} }
      for (const [k, v] of this.otpMap.entries()) obj.otps[k] = v
      for (const [k, v] of this.failures.entries()) obj.failures[k] = v
      for (const [k, v] of this.jailedUntil.entries()) obj.jailed[k] = v
      const enc = this.encryptObject(obj, key)
      await fs.promises.mkdir(require('path').dirname(this.otpFile), { recursive: true })
      await fs.promises.writeFile(this.otpFile, enc, 'utf8')
      return true
    } catch (e) {
      logger.warn('Failed to save OTP store:', (e && (e as Error).message) || e)
      return false
    }
  }

  private generateNumeric() {
    const max = Math.pow(10, this.otpLength)
    const num = crypto.randomInt(0, max)
    return String(num).padStart(this.otpLength, '0')
  }

  private generateAlphanumeric() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    let out = ''
    for (let i = 0; i < this.otpLength; i++) out += chars[crypto.randomInt(0, chars.length)]
    return out
  }

  private generateHex() {
    return crypto.randomBytes(Math.ceil(this.otpLength / 2)).toString('hex').slice(0, this.otpLength)
  }

  // a tiny 'mini-llm' that composes pronounceable tokens from syllables
  private generateMiniLlm() {
    const syllables = ['ra', 'ne', 'lo', 'mi', 'sa', 'tu', 've', 'ka', 'zu', 'pi', 'on', 'el']
    let out = ''
    while (out.length < this.otpLength) {
      out += syllables[crypto.randomInt(0, syllables.length)]
    }
    return out.slice(0, this.otpLength)
  }

  async generate(jid: string, opts?: { rngType?: RngType }) {
    if (!jid) throw new Error('jid required')
    // don't allow generating if jailed
    const now = Date.now()
    const jailedUntil = this.jailedUntil.get(jid) || 0
    if (jailedUntil > now) {
      this.emit('attemptWhileJailed', { jid, until: jailedUntil })
      throw new Error(`Jailed until ${new Date(jailedUntil).toISOString()}`)
    }

    const rng = opts?.rngType || this.rngType
    let code = ''
    if (rng === 'numeric') code = this.generateNumeric()
    else if (rng === 'alphanumeric') code = this.generateAlphanumeric()
    else if (rng === 'hex') code = this.generateHex()
    else code = this.generateMiniLlm()

    const expiresAt = Date.now() + this.otpTTL * 1000
    this.otpMap.set(jid, { code, expiresAt })
    await this.save()
    this.emit('generated', { jid, code, expiresAt, rng })
    return { code, expiresAt }
  }

  private recordFailure(jid: string) {
    const prev = this.failures.get(jid) || 0
    const now = Date.now()
    const current = prev + 1
    this.failures.set(jid, current)
    // apply configured jail threshold/duration
    if (current > 0 && current % this.jailThreshold === 0) {
      const until = now + this.jailDurationMs
      this.jailedUntil.set(jid, until)
      this.failures.set(jid, 0)
      this.save().catch(() => {})
      this.emit('jailed', { jid, until })
      return { jailed: true, until }
    }
    this.save().catch(() => {})
    return { jailed: false, attempts: current }
  }

  async verify(jid: string, code: string) {
    const now = Date.now()
    const jailedUntil = this.jailedUntil.get(jid) || 0
    if (jailedUntil > now) {
      this.emit('verifyBlocked', { jid, until: jailedUntil })
      return false
    }

    const entry = this.otpMap.get(jid)
    if (!entry) return false
    if (entry.expiresAt <= Date.now()) {
      this.otpMap.delete(jid)
      await this.save()
      this.emit('expired', { jid })
      return false
    }
    if (entry.code === code) {
      this.otpMap.delete(jid)
      this.failures.delete(jid)
      await this.save()
      this.emit('verified', { jid })
      return true
    }
    const res = this.recordFailure(jid)
    this.emit('failed', { jid, reason: 'invalid', details: res })
    return false
  }

  async delete(jid: string) {
    const ok = this.otpMap.delete(jid)
    if (ok) await this.save()
    this.emit('deleted', { jid, ok })
    return ok
  }

  async cleanup() {
    const now = Date.now()
    let changed = false
    for (const [k, v] of Array.from(this.otpMap.entries())) {
      if (v.expiresAt <= now) {
        this.otpMap.delete(k)
        changed = true
      }
    }
    // also clear expired jails
    for (const [k, v] of Array.from(this.jailedUntil.entries())) {
      if (v <= now) this.jailedUntil.delete(k)
    }
    if (changed) await this.save()
    return changed
  }

  // test helper
  _getMap() {
    return this.otpMap
  }

  _getFailures() {
    return this.failures
  }

  _getJailed() {
    return this.jailedUntil
  }

  /**
   * Return a plain object of currently jailed entries { jid: until }
   */
  listJailed() {
    const out: Record<string, number> = {}
    for (const [k, v] of this.jailedUntil.entries()) out[k] = v
    return out
  }

  /**
   * Remove a jid from the jail list (if present) and persist state.
   * Emits an `unjailed` event when successful.
   */
  async unjail(jid: string) {
    const had = this.jailedUntil.delete(jid)
    if (had) {
      try {
        await this.save()
      } catch (e) {
        // ignore
      }
      this.emit('unjailed', { jid })
    }
    return had
  }
}
