import * as admin from '../src/admin';
import * as config from '../src/config';

jest.mock('../src/config');

describe('admin helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('setAdminChannel writes config and returns true', async () => {
    (config.readConfig as jest.Mock).mockResolvedValueOnce({});
    (config.writeConfig as jest.Mock).mockResolvedValueOnce(true);
    const ok = await admin.setAdminChannel('config.json', '123@g.us');
    expect(ok).toBe(true);
    expect(config.readConfig).toHaveBeenCalledWith('config.json');
    expect(config.writeConfig).toHaveBeenCalledWith(
      'config.json',
      expect.objectContaining({ admin: expect.any(Object) }),
    );
  });

  test('unsetAdminChannel removes adminChannel and returns true', async () => {
    (config.readConfig as jest.Mock).mockResolvedValueOnce({ admin: { adminChannel: '123@g.us' } });
    (config.writeConfig as jest.Mock).mockResolvedValueOnce(true);
    const ok = await admin.unsetAdminChannel('config.json');
    expect(ok).toBe(true);
    expect(config.readConfig).toHaveBeenCalledWith('config.json');
    expect(config.writeConfig).toHaveBeenCalledWith(
      'config.json',
      expect.not.objectContaining({ admin: { adminChannel: '123@g.us' } }),
    );
  });
});
