#!/usr/bin/env node
// Cross-platform log tail helper for npm script `npm run logs`
// Reads config.json for logsDir (falls back to './logs') and tails today's log file.

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

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
