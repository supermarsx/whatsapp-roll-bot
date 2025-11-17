import createAccessControl from '../src/accessControl';
import { getReplyForText } from '../src/handler';

describe('admin commands', () => {
  test('handler returns admin markers when enabled', () => {
    const reply = getReplyForText('!shutdown');
    // Our default config (no file) enables shutdown in handler by default
    expect(reply).not.toBeNull();
    expect(reply?.text).toBe('!shutdown');
  });

  test('accessControl enforces admin only', () => {
    const ac = createAccessControl({
      admin: {
        admins: ['admin@c.us'],
        commands: ['!shutdown'],
        whitelist: { contacts: ['admin@c.us'] },
      },
    });
    expect(ac.isAdmin('admin@c.us')).toBe(true);
    expect(ac.isAdminCommandAllowed('!shutdown', 'admin@c.us')).toBe(true);
    expect(ac.isAdminCommandAllowed('!shutdown', 'bob@c.us')).toBe(false);
  });
});
