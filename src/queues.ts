import { createQueue } from './threads';

/**
 * Centralized queues for different subsystems. These are small, focused
 * serial queues that prevent bursts from blocking the event loop and allow
 * controlled concurrency for processing tasks.
 */
export const loggingQueue = createQueue(1);
export const processingQueue = createQueue(4);
export const answerQueue = createQueue(2);
export const securityQueue = createQueue(1);
