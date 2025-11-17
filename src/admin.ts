import { enqueueLog } from './asyncLogger';
import { readConfig, writeConfig } from './config';
import EncryptedOtpStore from './otpStore';

/**
 * Admin utilities
 *
 * Small helpers to manage the application's admin channel and to interact
 * with the OTP store for management tasks. These functions favor non-blocking
 * IO and enqueue log messages rather than performing heavy synchronous
 * logging in hot paths.
 *
 * @module admin
 */

/**
 * Set the admin channel in the runtime configuration file.
 * Uses async non-blocking IO via `src/config.ts` and enqueues log entries
 * to avoid blocking the main loop during log formatting.
 *
 * @param {string} cfgPath - Path to JSON config file
 * @param {string} groupJid - Group JID to set as admin channel
 * @returns {Promise<boolean>} true on success, false on failure
 */
export async function setAdminChannel(cfgPath: string, groupJid: string): Promise<boolean> {
  try {
    const cur = await readConfig(cfgPath);
    const updated = {
      ...(cur || {}),
      admin: { ...((cur || {}).admin || {}), adminChannel: groupJid },
    };
    const ok = await writeConfig(cfgPath, updated);
    if (ok) enqueueLog('info', `Admin channel set to ${groupJid}`);
    return ok;
  } catch (e) {
    enqueueLog(
      'warn',
      'Failed to persist adminChannel to config.json: ' + ((e && (e as Error).message) || e),
    );
    return false;
  }
}

/**
 * Unset the admin channel in the runtime configuration file.
 *
 * @param {string} cfgPath - Path to JSON config file
 * @returns {Promise<boolean>} true on success, false on failure
 */
export async function unsetAdminChannel(cfgPath: string): Promise<boolean> {
  try {
    const cur = await readConfig(cfgPath);
    if (cur.admin) delete cur.admin.adminChannel;
    const ok = await writeConfig(cfgPath, cur);
    if (ok) enqueueLog('info', 'Admin channel unset');
    return ok;
  } catch (e) {
    enqueueLog(
      'warn',
      'Failed to unset adminChannel in config.json: ' + ((e && (e as Error).message) || e),
    );
    return false;
  }
}

/**
 * Get jailed entries from the OTP store.
 *
 * This wrapper calls into the provided EncryptedOtpStore instance and
 * returns its `listJailed()` result. Errors are logged and an empty object
 * is returned on failure to keep callers simple.
 *
 * @param {EncryptedOtpStore} otpStore - Instance of EncryptedOtpStore
 * @returns {Record<string, number>} Map of jid -> until timestamp or empty object on failure
 */
export function listJailed(otpStore: EncryptedOtpStore) {
  try {
    return otpStore.listJailed();
  } catch (e) {
    enqueueLog('warn', 'Failed to list jailed: ' + ((e && (e as Error).message) || e));
    return {};
  }
}

/**
 * Unjail a target JID using the provided OTP store.
 *
 * @param {EncryptedOtpStore} otpStore - Instance of EncryptedOtpStore
 * @param {string} jid - JID to unjail
 * @returns {Promise<boolean>} true if unjailed, false otherwise
 */
export async function unjail(otpStore: EncryptedOtpStore, jid: string): Promise<boolean> {
  try {
    return await otpStore.unjail(jid);
  } catch (e) {
    enqueueLog('warn', 'Failed to unjail: ' + ((e && (e as Error).message) || e));
    return false;
  }
}
