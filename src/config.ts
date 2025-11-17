import fs from 'fs/promises';
import fsSync from 'fs';
import { enqueueLog } from './asyncLogger';

/**
 * Async helper to read and write JSON config files.
 * Provides non-blocking FS usage and safe defaults for tests.
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

export async function writeConfig(cfgPath: string, obj: any): Promise<boolean> {
  try {
    await fs.writeFile(cfgPath, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    enqueueLog('warn', `Failed to write config ${cfgPath}: ${(e && (e as Error).message) || e}`);
    return false;
  }
}
