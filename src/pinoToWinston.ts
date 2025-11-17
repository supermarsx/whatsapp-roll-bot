/**
 * Adapter to present a pino-compatible logger API that forwards messages to a
 * Winston logger. This lets code that expects a pino logger (like Baileys)
 * interact with Winston-backed transports without changing their logging calls.
 *
 * The adapter implements the common pino methods: `trace`, `debug`, `info`,
 * `warn`, `error`, `fatal`, and `child`. Calls are forwarded to the provided
 * Winston logger using a sensible level mapping.
 *
 * Note: this is a lightweight adapter intended for application-level usage and
 * to satisfy libraries that expect a pino-like interface. It does not implement
 * every pino feature (e.g. serializers, extreme mode, destinations).
 */

import type { Logger as WinstonLogger } from 'winston'

/**
 * Create a pino-compatible logger that forwards to a Winston logger.
 *
 * @param winstonLogger - The underlying Winston logger instance to forward to.
 * @returns A pino-like logger object compatible with libraries expecting pino.
 */
export default function createPinoCompatibleLogger(winstonLogger: WinstonLogger) {
  const levelMap: Record<string, string> = {
    trace: 'silly',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error',
    fatal: 'error',
  }

  const makeMethod = (level: string) => {
    return (...args: any[]) => {
      try {
        const msg = args
          .map((a) => {
            if (typeof a === 'string') return a
            try {
              return JSON.stringify(a)
            } catch (e) {
              return String(a)
            }
          })
          .join(' ')
        winstonLogger.log({ level: levelMap[level] || 'info', message: msg })
      } catch (e) {
        // swallow to avoid breaking callers
      }
    }
  }

  const adapter: any = {
    level: 'info',
    child: () => adapter,
    trace: makeMethod('trace'),
    debug: makeMethod('debug'),
    info: makeMethod('info'),
    warn: makeMethod('warn'),
    error: makeMethod('error'),
    fatal: makeMethod('fatal'),
  }

  return adapter as unknown as any
}
