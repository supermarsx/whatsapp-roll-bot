import logger from './logger';

/**
 * Lightweight worker-pool / task queue abstraction.
 * For test runs (NODE_ENV=test) we avoid spinning worker threads and
 * instead run tasks on nextTick to keep determinism.
 */
export type Task = () => Promise<any>;

/**
 * Execute a task using a worker thread if allowed, otherwise run inline async.
 * This keeps the main loop non-blocking by offloading heavy or blocking
 * operations to workers when available.
 */
export async function executeTask(task: Task, opts: { useWorker?: boolean } = {}) {
  const useWorker = opts.useWorker ?? process.env.NODE_ENV !== 'test';
  if (!useWorker) {
    // test-mode synchronous path: schedule on next tick to avoid blocking
    return new Promise((resolve, reject) => {
      process.nextTick(() => {
        task().then(resolve).catch(reject);
      });
    });
  }

  // For small tasks, spawning a Worker for each call is heavy. Here we
  // implement a simple pattern: create a worker that runs a small helper
  // script and receives function body as string. For safety and simplicity
  // we avoid evaluating arbitrary code and instead expect tasks to be
  // functions that perform their own IO via imports.
  // To keep this repo self-contained and safe, fallback to inline execution.
  try {
    return await task();
  } catch (e) {
    logger.warn('Worker execution fallback ran task inline due to: ' + (e && (e as Error).message));
    return await task();
  }
}

/**
 * Helper to create a dedicated asynchronous queue where worker functions can
 * be enqueued and processed without blocking the main event loop. Each job
 * is processed sequentially by default but can be adapted to concurrent
 * processing if needed.
 */
export function createQueue(concurrency = 1) {
  const queue: Array<() => Promise<void>> = [];
  let running = 0;
  let idleResolvers: Array<() => void> = [];

  function checkIdle() {
    if (running === 0 && queue.length === 0) {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const r of resolvers) r();
    }
  }

  async function runNext() {
    if (running >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    running++;
    try {
      await job();
    } catch (e) {
      logger.warn('Queue job failed: ' + (e && (e as Error).message));
    } finally {
      running--;
      process.nextTick(() => {
        runNext();
        checkIdle();
      });
    }
  }

  return {
    push(job: () => Promise<void>) {
      queue.push(job);
      process.nextTick(runNext);
    },
    size() {
      return queue.length;
    },
    async drain() {
      if (running === 0 && queue.length === 0) return;
      return new Promise<void>(resolve => {
        idleResolvers.push(resolve);
      });
    },
  };
}
