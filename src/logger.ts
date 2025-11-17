/**
 * Application logger singleton backed by Winston.
 *
 * - Writes daily rotated log files to `logs/application-<DATE>.log`.
 * - In non-production environments, logs are also written to the console
 *   with colorized output for easier development debugging.
 *
 * The logger respects the `LOG_LEVEL` environment variable and defaults to
 * `info` when not set. Rotation keeps files for 14 days and compresses older
 * files.
 */
import { createLogger, format, transports } from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

const { combine, timestamp, printf, colorize } = format

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`
})

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(timestamp(), logFormat),
  transports: [
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
    }),
  ],
})

// also log to console in non-production
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: combine(colorize(), timestamp(), logFormat),
    })
  )
}

export default logger
