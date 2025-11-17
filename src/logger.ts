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

// Attempt to read `config.json` to allow runtime configuration of logging
let logsDir = 'logs'
let defaultLevel = process.env.LOG_LEVEL || 'info'
let dailyRotate = true
let maxSize = '20m'
let maxFiles = '14d'
let consoleEnabled = process.env.NODE_ENV !== 'production'

try {
  // require here so import-time doesn't try to load fs/promises in ESM oddities
  // and so tests that don't have config.json aren't impacted.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs')
  const cfgPath = 'config.json'
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, 'utf8')
    const parsed = JSON.parse(raw)
    logsDir = parsed?.paths?.logsDir || logsDir
    defaultLevel = parsed?.logging?.level || defaultLevel
    dailyRotate = parsed?.logging?.dailyRotate ?? dailyRotate
    maxSize = parsed?.logging?.maxSize || maxSize
    maxFiles = parsed?.logging?.maxFiles || maxFiles
    consoleEnabled = parsed?.logging?.console ?? consoleEnabled
  }
} catch (e) {
  // ignore and use defaults
}

// ensure logs dir exists
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs')
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true })
} catch (e) {
  // ignore
}

const transportsList: any[] = []
if (dailyRotate) {
  transportsList.push(
    new DailyRotateFile({
      filename: `${logsDir}/application-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize,
      maxFiles,
      level: defaultLevel,
    })
  )
} else {
  transportsList.push(new transports.File({ filename: `${logsDir}/application.log`, level: defaultLevel }))
}

if (consoleEnabled) {
  transportsList.push(new transports.Console({ format: combine(colorize(), timestamp(), logFormat) }))
}

const logger = createLogger({
  level: defaultLevel,
  format: combine(timestamp(), logFormat),
  transports: transportsList,
})

export default logger
