import logger from './logger';

/**
 * Event dispatch utilities
 *
 * This module provides helpers to dispatch named events to external HTTP
 * webhook endpoints when enabled in `config.json` under `events.hooks`.
 * The implementation is intentionally small and defensive: it reads
 * `config.json` at runtime, validates that the particular hook is enabled
 * and has a URL, performs a short HTTP request and logs the outcome using
 * the application's asyncLogger when available (falls back to the
 * synchronous logger otherwise).
 *
 * Configuration shape (example):
 * {
 *   "events": {
 *     "enabled": true,
 *     "hooks": {
 *       "someEvent": { "enabled": true, "url": "https://...", "method": "POST", "headers": { ... } }
 *     }
 *   }
 * }
 *
 * @module events
 */

/**
 * Dispatch a named event to the configured webhook hook (if enabled).
 *
 * The function attempts to load `config.json` from the current working
 * directory and looks up `events.hooks[eventName]`. If the global
 * configuration permits event hooks and the specific hook is enabled and
 * provides a URL the function performs an HTTP request with a JSON body
 * containing the event name and payload.
 *
 * Notes:
 * - The function prefers the global `fetch` if present, otherwise it will
 *   require `node-fetch`.
 * - Logging is attempted via `safeEnqueue` from `./asyncLogger` (if
 *   available) to avoid blocking; the fallback is the standard `logger`.
 * - The HTTP request uses a short timeout (5000ms) and considers 200/201/204
 *   as success responses.
 *
 * @param {string} eventName - Logical name of the event to dispatch.
 * @param {*} payload - Arbitrary payload object that will be JSON-serialized and sent.
 * @returns {Promise<{ok: boolean, reason?: string}>} An object indicating whether the dispatch succeeded. When `ok` is false, `reason` may contain a short explanation.
 */
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
    const method = evCfg.method || 'POST';
    const headers = evCfg.headers || { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ event: eventName, payload });
    // Use global fetch and AbortController (Node 24+). Timeout via AbortController.
    const controller = new (globalThis as any).AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await (globalThis as any).fetch(evCfg.url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const ok = res && (res.status === 200 || res.status === 201 || res.status === 204);
      try {
        const { safeEnqueue } = require('./asyncLogger');
        safeEnqueue('info', `Event hook ${eventName} -> ${evCfg.url} ${ok ? 'ok' : 'failed'}`);
      } catch {
        logger.info(`Event hook ${eventName} -> ${evCfg.url} ${ok ? 'ok' : 'failed'}`);
      }
      return { ok };
    } finally {
      clearTimeout(timer);
    }
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
