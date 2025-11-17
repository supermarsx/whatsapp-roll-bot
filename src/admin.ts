import fs from 'fs'
import logger from './logger'
import EncryptedOtpStore from './otpStore'

export async function setAdminChannel(cfgPath: string, groupJid: string) {
  try {
    let cur: any = {}
    try {
      if (fs.existsSync(cfgPath)) cur = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    } catch (e) {
      // ignore
    }
    cur = { ...(cur || {}), admin: { ...((cur || {}).admin || {}), adminChannel: groupJid } }
    fs.writeFileSync(cfgPath, JSON.stringify(cur, null, 2), 'utf8')
    logger.info(`Admin channel set to ${groupJid}`)
    return true
  } catch (e) {
    logger.warn('Failed to persist adminChannel to config.json: ' + (e && (e as Error).message))
    return false
  }
}

export async function unsetAdminChannel(cfgPath: string) {
  try {
    let cur: any = {}
    try {
      if (fs.existsSync(cfgPath)) cur = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    } catch (e) {
      // ignore
    }
    if (cur.admin) delete cur.admin.adminChannel
    fs.writeFileSync(cfgPath, JSON.stringify(cur, null, 2), 'utf8')
    logger.info('Admin channel unset')
    return true
  } catch (e) {
    logger.warn('Failed to unset adminChannel in config.json: ' + (e && (e as Error).message))
    return false
  }
}

export function listJailed(otpStore: EncryptedOtpStore) {
  try {
    return otpStore.listJailed()
  } catch (e) {
    logger.warn('Failed to list jailed: ' + (e && (e as Error).message))
    return {}
  }
}

export async function unjail(otpStore: EncryptedOtpStore, jid: string) {
  try {
    return await otpStore.unjail(jid)
  } catch (e) {
    logger.warn('Failed to unjail: ' + (e && (e as Error).message))
    return false
  }
}
