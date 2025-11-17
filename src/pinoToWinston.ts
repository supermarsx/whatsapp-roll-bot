/**
 * pino -> Winston adapter
 *
 * This module exposes a small adapter that presents a subset of the pino
 * logging API while forwarding messages to a Winston logger instance. The
 * adapter is intentionally lightweight: it supports the common logging
 * methods used by libraries (trace, debug, info, warn, error, fatal) and a
 * `child` method that returns the same adapter. The goal is compatibility
 * for libraries that expect a pino-style logger (for example Baileys) while
 * allowing the application to use Winston transports and formatting.
 *
 * Notes:
 * - The adapter does not implement pino serializers, extreme mode, or the
 *   full pino configuration surface. It converts non-string arguments to
 *   JSON where possible and falls back to String().
 * - `fatal` is mapped to Winston's `error` level because Winston usually
 *   does not define a distinct fatal level by default.
 *
 * @module pinoToWinston
 */

import type { Logger as WinstonLogger } from 'winston';

/**
 * Minimal pino-like logger interface used by consumers of this adapter.
 * This documents the subset of pino the adapter implements.
 *
 * @typedef {Object} PinoLikeLogger
 * @property {string} level - Current log level name.
 * @property {() => PinoLikeLogger} child - Create a child logger (returns same adapter).
 * @property {(...args: any[]) => void} trace
 * @property {(...args: any[]) => void} debug
 * @property {(...args: any[]) => void} info
 * @property {(...args: any[]) => void} warn
 * @property {(...args: any[]) => void} error
 * @property {(...args: any[]) => void} fatal
 */

/**
 * Create a pino-compatible logger that forwards to a Winston logger.
 *
 * The returned object implements the minimal pino API expected by most
 * libraries: logging methods for several levels and `child()` which returns
 * a logger instance. All messages are forwarded to `winstonLogger.log` with
 * a mapped level and a composed message string.
 *
 * @param {WinstonLogger} winstonLogger - The underlying Winston logger instance to forward to.
 * @returns {PinoLikeLogger} A pino-like logger object compatible with libraries expecting pino.
 */
export default function createPinoCompatibleLogger(winstonLogger: WinstonLogger) {
  /**
   * Map pino levels to Winston levels. Keys are pino method names.
   * @type {Record<string, string>}
   */
  const levelMap: Record<string, string> = {
    trace: 'silly',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error',
    fatal: 'error',
  };

  /**
   * Build a logging method that forwards its arguments to Winston.
   *
   * The produced function will try to stringify non-string arguments as
   * JSON. If JSON.stringify fails (circular structures, etc.) it will fall
   * back to calling String() on the value. All arguments are joined with a
   * space to produce the final message.
   *
   * @param {string} level - The pino-level name (e.g. 'info').
   * @returns {(...args: any[]) => void} A function that accepts varargs and logs them.
   */
  const makeMethod = (level: string) => {
    return (...args: any[]) => {
      try {
        const msg = args
          .map(a => {
            if (typeof a === 'string') return a;
            try {
              return JSON.stringify(a);
            } catch (e) {
              return String(a);
            }
          })
          .join(' ');
        winstonLogger.log({ level: levelMap[level] || 'info', message: msg });
      } catch (e) {
        // swallow to avoid breaking callers
      }
    };
  };

  /**
   * Adapter object implementing the documented PinoLikeLogger interface.
   * `child` returns the same adapter to satisfy libraries that call
   * logger.child({ ... }). The `level` property is kept for compatibility
   * though it is not synchronized with the underlying Winston logger's
   * runtime level changes.
   *
   * @type {PinoLikeLogger}
   */
  const adapter: any = {
    level: 'info',
    child: () => adapter,
    trace: makeMethod('trace'),
    debug: makeMethod('debug'),
    info: makeMethod('info'),
    warn: makeMethod('warn'),
    error: makeMethod('error'),
    fatal: makeMethod('fatal'),
  };

  return adapter as unknown as any;
}
