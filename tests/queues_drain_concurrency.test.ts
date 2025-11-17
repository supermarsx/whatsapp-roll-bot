import { createQueue } from '../src/threads';

describe('queue concurrency and drain', () => {
  test('drain waits for concurrent jobs to finish', async () => {
    const q = createQueue(2);
    let running = 0;
    const timeline: string[] = [];

    const job = (id: number) => async () => {
      running++;
      timeline.push(`start-${id}-${running}`);
      await new Promise(r => setTimeout(r, 50));
      timeline.push(`end-${id}-${running}`);
      running--;
    };

    q.push(job(1));
    q.push(job(2));
    q.push(job(3));

    // at this point there should be jobs running/queued
    await (q as any).drain();

    // all jobs completed
    expect(running).toBe(0);
    expect(timeline.length).toBe(6);
    // ensure some concurrency happened (at some point running was 2)
    expect(timeline.some(t => t.startsWith('start-') && t.includes('-2'))).toBe(true);
  });
});
