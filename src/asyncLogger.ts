import logger from './logger';
import { loggingQueue } from './queues';

/**
 * Asynchronous logging helpers
 *
 * These helpers provide a non-blocking way to emit log messages from
 * hot paths by pushing formatting and write operations to a small dedicated
 * queue. The queue keeps bursts of logging from blocking the main event
 * loop and reduces contention for synchronous console/file formatting.
 *
 * @module asyncLogger
 */

/**
 * Enqueue a log message to be written via the application's logger.
 * This prevents bursts of synchronous formatting from blocking the main
 * event loop by offloading formatting + write to a dedicated queue.
 *
 * The function pushes a job to the shared `loggingQueue` which will call
 * into the configured Winston logger. The job itself is executed
 * asynchronously and will not throw to the caller; any internal errors
 * are handled within the queued task.
 *
 * @param {'info'|'warn'|'error'|'debug'} level - Log level to use.
 * @param {string} msg - Message to log.
 * @returns {void}
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
 * synchronous code paths where async/await or module resolution may not be
 * available.
 *
 * The helper is best-effort: it will swallow any errors to ensure that
 * logging never throws during application initialization or error handling.
 *
 * @param {'info'|'warn'|'error'|'debug'} level - Log level to use.
 * @param {string} msg - Message to log.
 * @returns {void}
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
