import { enqueueLog } from '../src/asyncLogger';
import { loggingQueue } from '../src/queues';
import logger from '../src/logger';

describe('asyncLogger and loggingQueue drain', () => {
  test('enqueueLog schedules a log and drain waits for it', async () => {
    // Spy on logger.log to observe calls
    const orig = logger.log;
    const calls: any[] = [];
    // @ts-ignore
    logger.log = (obj: any) => {
      calls.push(obj);
    };

    enqueueLog('info', 'test-message-1');
    enqueueLog('warn', 'test-message-2');

    // At this point, tasks are enqueued; drain should wait for them to complete
    await (loggingQueue as any).drain();

    expect(calls.find((c: any) => c.message === 'test-message-1')).toBeDefined();
    expect(calls.find((c: any) => c.message === 'test-message-2')).toBeDefined();

    // restore
    // @ts-ignore
    logger.log = orig;
  });
});
