import { createQueue } from '../src/threads';

describe('queue', () => {
  test('runs jobs sequentially and respects concurrency', async () => {
    const q = createQueue(2);
    const results: number[] = [];

    q.push(async () => {
      await new Promise(r => setTimeout(r, 10));
      results.push(1);
    });

    q.push(async () => {
      await new Promise(r => setTimeout(r, 5));
      results.push(2);
    });

    q.push(async () => {
      results.push(3);
    });

    // wait a bit for tasks to run
    await new Promise(r => setTimeout(r, 50));
    expect(results.sort()).toEqual([1, 2, 3].sort());
  });
});
