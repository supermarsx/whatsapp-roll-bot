import logger from './logger';
import { loggingQueue } from './queues';

/**
 * Enqueue a log message to be written via the application's logger.
 * This prevents bursts of synchronous formatting from blocking the main
 * event loop by offloading formatting + write to a dedicated queue.
 */
export function enqueueLog(level: 'info' | 'warn' | 'error' | 'debug', msg: string) {
  loggingQueue.push(async () => {
    // Format and write using Winston (which is non-blocking for file IO)
    logger.log({ level, message: msg });
  });
}

/**
 * Safe enqueue helper that attempts to use `enqueueLog` synchronously when
 * available and otherwise falls back to calling the logger directly. This
 * helper avoids requiring `await import(...)` in constructors or other
 * synchronous code paths.
 */
export function safeEnqueue(level: 'info' | 'warn' | 'error' | 'debug', msg: string) {
  try {
    // If the module was imported normally, just call the local function.
    enqueueLog(level, msg);
  } catch {
    try {
      // If something odd occurs (rare), fall back to direct logger usage.
      logger.log({ level, message: msg });
    } catch {
      // Best-effort: swallow errors here to avoid cascading failures during
      // initialization paths where logging must not throw.
    }
  }
}
