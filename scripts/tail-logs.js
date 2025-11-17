#!/usr/bin/env node
// Cross-platform log tail helper for npm script `npm run logs`
// Reads config.json for logsDir (falls back to './logs') and tails today's log file.

/**
 * tail-logs script
 *
 * This small executable locates today's application log file (by default
 * `logs/application-YYYY-MM-DD.log` or as configured in `config.json`) and
 * streams new lines to stdout. On Windows it uses PowerShell's
 * Get-Content -Wait; on POSIX systems it invokes `tail -F`.
 *
 * The script is intended for developer convenience and is used by the
 * project's npm scripts. It prefers a `config.json` in the current working
 * directory for `paths.logsDir` or `logging.logsDir` but falls back to
 * `./logs` when not present.
 *
 * @module scripts/tail-logs
 */

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

/**
 * Read and parse a local `config.json` file if present.
 *
 * If the file is missing or cannot be parsed an empty object is returned and
 * an error is written to stderr.
 *
 * @returns {Object} Parsed configuration object or an empty object on error.
 */
function readConfig() {
  try {
    const p = path.resolve(process.cwd(), 'config.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error('Failed to read config.json:', err.message);
    return {};
  }
}

/**
 * Main entrypoint: determine today's log filename and stream it to stdout.
 *
 * Behavior:
 * - Determine logs directory from config.paths.logsDir or
 *   config.logging.logsDir, falling back to 'logs'.
 * - Build filename `application-YYYY-MM-DD.log` for today's date.
 * - If the file does not exist exit with code 1.
 * - On Windows spawn PowerShell Get-Content -Wait, otherwise spawn `tail -F`.
 *
 * The process inherits stdio so log lines are printed directly to the
 * console. Child process exit codes are propagated to the script's exit.
 *
 * @returns {void}
 */
function main() {
  const cfg = readConfig();
  const logsDir =
    (cfg.paths && cfg.paths.logsDir) || (cfg.logging && cfg.logging.logsDir) || 'logs';
  const date = new Date().toISOString().slice(0, 10);
  const filename = path.join(process.cwd(), logsDir, `application-${date}.log`);

  if (!fs.existsSync(filename)) {
    console.error('No log for today at', filename);
    process.exit(1);
  }

  console.log('Tailing', filename);

  if (process.platform === 'win32') {
    // Use PowerShell Get-Content -Wait
    const cmd = 'powershell';
    const args = ['-NoProfile', '-Command', `Get-Content -Path '${filename}' -Wait`];
    const ps = child_process.spawn(cmd, args, { stdio: 'inherit' });
    ps.on('exit', code => process.exit(code));
  } else {
    // Use tail -F for linux/mac
    const tail = child_process.spawn('tail', ['-F', filename], { stdio: 'inherit' });
    tail.on('exit', code => process.exit(code));
  }
}

main();
