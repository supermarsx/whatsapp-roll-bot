import createAccessControl from '../src/accessControl';

describe('access control', () => {
  test('defaults allow when no whitelist/blacklist', () => {
    const ac = createAccessControl();
    expect(ac.isMessageAllowed({ text: 'hello', from: 'user@c.us' })).toBe(true);
  });

  test('contact whitelist works', () => {
    const ac = createAccessControl({ whitelist: { contacts: ['alice@c.us'] } });
    expect(ac.isMessageAllowed({ text: 'hello', from: 'alice@c.us' })).toBe(true);
    expect(ac.isMessageAllowed({ text: 'hello', from: 'bob@c.us' })).toBe(false);
  });

  test('group whitelist works', () => {
    const ac = createAccessControl({ whitelist: { groups: ['123@g.us'] } });
    expect(
      ac.isMessageAllowed({
        text: '!ping',
        from: 'someone@c.us',
        isGroup: true,
        groupJid: '123@g.us',
      }),
    ).toBe(true);
    expect(
      ac.isMessageAllowed({
        text: '!ping',
        from: 'someone@c.us',
        isGroup: true,
        groupJid: '999@g.us',
      }),
    ).toBe(false);
  });

  test('blacklist patterns block', () => {
    const ac = createAccessControl({ blacklist: { patterns: ['curl'] } });
    expect(ac.isMessageAllowed({ text: 'please curl this', from: 'u@c.us' })).toBe(false);
    expect(ac.isMessageAllowed({ text: 'hello', from: 'u@c.us' })).toBe(true);
  });

  test('admin command allowed only for admin and whitelisted', () => {
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
