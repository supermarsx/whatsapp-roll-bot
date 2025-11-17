import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { enqueueLog } from './asyncLogger';

/**
 * Start a daily monitor that inspects the log directory to ensure rotation
 * appears to be working and that recent log files exist and are of reasonable
 * size. It can also purge old rotated logs beyond `retainDays` and call a
 * webhook when issues are detected.
 */
export function startLogRotationMonitor(
  logsDir: string,
  options: { maxSizeBytes?: number; retainDays?: number; webhookUrl?: string } = {},
) {
  const maxSize = options.maxSizeBytes ?? 200 * 1024 * 1024; // 200 MB sanity limit
  const retainDays = options.retainDays ?? 14; // keep 14 days by default
  const webhookUrl = options.webhookUrl;

  async function sendWebhook(payload: any) {
    if (!webhookUrl) return;
    try {
      // Use global fetch with AbortController for timeout
      const controller = new (globalThis as any).AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        await (globalThis as any).fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      enqueueLog(
        'warn',
        'Log rotation monitor: failed to call webhook: ' + ((e && (e as Error).message) || e),
      );
    }
  }

  async function purgeOldFiles(dir: string) {
    try {
      const files = await fs.readdir(dir);
      const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
      let removed = 0;
      for (const f of files) {
        if (!f.startsWith('application-')) continue;
        try {
          const st = await fs.stat(path.join(dir, f));
          if (!st.isFile()) continue;
          if (st.mtimeMs < cutoff) {
            await fs.unlink(path.join(dir, f));
            removed++;
            enqueueLog('info', `Log rotation monitor: purged old log ${f}`);
          }
        } catch (e) {
          enqueueLog(
            'warn',
            `Log rotation monitor: failed to purge ${f}: ${(e && (e as Error).message) || e}`,
          );
        }
      }
      return removed;
    } catch (e) {
      enqueueLog(
        'warn',
        'Log rotation monitor: purge failed: ' + ((e && (e as Error).message) || e),
      );
      return 0;
    }
  }

  async function checkOnce() {
    try {
      const dir = path.resolve(process.cwd(), logsDir || 'logs');
      if (!fsSync.existsSync(dir)) {
        const msg = `Log rotation monitor: logs dir missing: ${dir}`;
        enqueueLog('warn', msg);
        await sendWebhook({ status: 'missing_logs_dir', dir, message: msg });
        return;
      }
      const files = await fs.readdir(dir);
      // look for today's and yesterday's files using application-YYYY-MM-DD.log pattern
      const today = new Date().toISOString().slice(0, 10);
      const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const todayName = `application-${today}.log`;
      const yesterName = `application-${yesterdayDate}.log`;

      const hasToday = files.includes(todayName);
      const hasYesterday = files.includes(yesterName);

      if (!hasToday) {
        const msg = `Log rotation monitor: today's log not found: ${todayName}`;
        enqueueLog('warn', msg);
        await sendWebhook({ status: 'missing_today', file: todayName, message: msg });
      }
      if (!hasYesterday) {
        const msg = `Log rotation monitor: no rotated file found for yesterday (${yesterName}) — this may be fine on first run`;
        enqueueLog('info', msg);
      }

      // check sizes of recent files
      const suspect: string[] = [];
      for (const fname of files.filter(f => f.startsWith('application-')).slice(-30)) {
        try {
          const st = await fs.stat(path.join(dir, fname));
          if (!st.isFile()) continue;
          if (st.size === 0) {
            enqueueLog('warn', `Log rotation monitor: file ${fname} has size 0`);
            suspect.push(fname);
          }
          if (st.size > maxSize) {
            enqueueLog(
              'warn',
              `Log rotation monitor: file ${fname} is large (${Math.round(st.size / 1024 / 1024)} MB)`,
            );
            suspect.push(fname);
          }
        } catch (e) {
          enqueueLog(
            'warn',
            `Log rotation monitor: failed to stat ${fname}: ${(e && (e as Error).message) || e}`,
          );
        }
      }

      // attempt purge of old files
      const purged = await purgeOldFiles(dir);
      if (purged > 0) await sendWebhook({ status: 'purged', count: purged });

      if (suspect.length > 0) {
        await sendWebhook({ status: 'suspect_files', files: suspect });
      }

      enqueueLog('info', 'Log rotation monitor: completed checks');
    } catch (e) {
      enqueueLog('warn', 'Log rotation monitor failed: ' + ((e && (e as Error).message) || e));
      await sendWebhook({ status: 'error', message: (e && (e as Error).message) || e });
    }
  }

  // run immediately
  void checkOnce();
  // schedule daily check (run every 24h)
  const handle = setInterval(() => void checkOnce(), 24 * 60 * 60 * 1000);

  return {
    stop() {
      clearInterval(handle);
    },
    checkOnce,
    purgeOldFiles: (d?: string) => purgeOldFiles(path.resolve(process.cwd(), d || logsDir)),
  };
}
