import { getReplyForText } from '../src/handler';

describe('help command', () => {
  test('returns help text containing enabled commands', () => {
    const reply = getReplyForText('!help');
    expect(reply).not.toBeNull();
    expect(reply?.text).toMatch(/Available commands/);
    expect(reply?.text).toMatch(/!dN/); // roll usage should be present
    expect(reply?.text).toMatch(/!ping/); // ping should be present
  });
});
