import fs from 'fs/promises';
import fsSync from 'fs';
import { enqueueLog } from './asyncLogger';

/**
 * Configuration file helpers
 *
 * Small utility functions to read and write JSON configuration files using
 * non-blocking fs/promises APIs. These helpers are defensive: missing files
 * or parse/write errors are handled gracefully and produce logged warnings
 * while returning safe defaults so callers can continue operation.
 *
 * @module config
 */

/**
 * Read and parse a JSON configuration file asynchronously.
 *
 * If the file does not exist this function resolves with an empty object.
 * Any read or parse errors are caught, a warning is enqueued via the
 * application's async logger and an empty object is returned so callers can
 * safely merge defaults.
 *
 * @param {string} cfgPath - Path to the JSON file to read.
 * @returns {Promise<any>} A promise that resolves to the parsed object, or an empty object on error or when the file is missing.
 */
export async function readConfig(cfgPath: string): Promise<any> {
  try {
    if (!fsSync.existsSync(cfgPath)) return {};
    const raw = await fs.readFile(cfgPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    enqueueLog('warn', `Failed to read config ${cfgPath}: ${(e && (e as Error).message) || e}`);
    return {};
  }
}

/**
 * Write an object to a JSON configuration file asynchronously.
 *
 * The object is serialized with 2-space indentation. On success the
 * promise resolves to true; on failure a warning is enqueued and the
 * function returns false.
 *
 * @param {string} cfgPath - Path to the JSON file to write.
 * @param {*} obj - The object to serialize and write to disk.
 * @returns {Promise<boolean>} True if the file was written successfully, false otherwise.
 */
export async function writeConfig(cfgPath: string, obj: any): Promise<boolean> {
  try {
    await fs.writeFile(cfgPath, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    enqueueLog('warn', `Failed to write config ${cfgPath}: ${(e && (e as Error).message) || e}`);
    return false;
  }
}
