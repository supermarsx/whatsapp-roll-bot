import logger from './logger';

export async function dispatchEvent(eventName: string, payload: any) {
  try {
    // load config.json and check events.hooks
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const cfgPath = 'config.json';
    if (!fs.existsSync(cfgPath)) return { ok: false, reason: 'no-config' };
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(raw);
    const evCfg = cfg?.events?.hooks?.[eventName];
    if (!cfg?.events?.enabled || !evCfg || !evCfg.enabled || !evCfg.url)
      return { ok: false, reason: 'disabled' };
    const fetchFn = (global as any).fetch || require('node-fetch');
    const method = evCfg.method || 'POST';
    const headers = evCfg.headers || { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ event: eventName, payload });
    const res = await fetchFn(evCfg.url, { method, headers, body, timeout: 5000 });
    const ok = res && (res.status === 200 || res.status === 201 || res.status === 204);
    try {
      // prefer synchronous safeEnqueue when available
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { safeEnqueue } = require('./asyncLogger');
      safeEnqueue('info', `Event hook ${eventName} -> ${evCfg.url} ${ok ? 'ok' : 'failed'}`);
    } catch {
      logger.info(`Event hook ${eventName} -> ${evCfg.url} ${ok ? 'ok' : 'failed'}`);
    }
    return { ok };
  } catch (e) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { safeEnqueue } = require('./asyncLogger');
      safeEnqueue('warn', 'Failed to dispatch event: ' + (e && (e as Error).message));
    } catch {
      logger.warn('Failed to dispatch event: ' + (e && (e as Error).message));
    }
    return { ok: false, reason: e && (e as Error).message };
  }
}
