import { createQueue } from './threads';

/**
 * Central place for application queues.
 *
 * These named queues provide small, focused serial/concurrent execution
 * contexts for different subsystems so that bursts of work do not block the
 * main event loop and so that related tasks can be serialized when order
 * matters.
 *
 * Each queue implements the following interface (see `createQueue`):
 * @typedef {Object} AsyncQueue
 * @property {(job: () => Promise<void>) => void} push - Enqueue a job for execution.
 * @property {() => number} size - Return the number of jobs waiting in the queue.
 * @property {() => Promise<void>} drain - Resolve when the queue is fully drained.
 *
 * @module queues
 */

/**
 * Queue for logging tasks. Uses concurrency = 1 to preserve order and
 * reduce contention when writing logs or sending telemetry.
 * @type {AsyncQueue}
 */
export const loggingQueue = createQueue(1);

/**
 * Queue for general processing tasks. This queue allows limited
 * concurrency to improve throughput for CPU or I/O bound jobs.
 * @type {AsyncQueue}
 */
export const processingQueue = createQueue(4);

/**
 * Queue used for preparing and sending answers/messages. A small
 * concurrency helps parallelize sending while keeping rate under
 * control.
 * @type {AsyncQueue}
 */
export const answerQueue = createQueue(2);

/**
 * Queue for security-sensitive operations which should run serially to
 * avoid race conditions (e.g. updating credentials or access control state).
 * @type {AsyncQueue}
 */
export const securityQueue = createQueue(1);
