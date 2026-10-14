import { afterEach, describe, expect, it, vi } from 'vitest';

const environmentKeys = [
  'NODE_ENV', 'TOTP_ACCEPT_ANY_CODE', 'DEMO_ACCOUNTS_ENABLED', 'SMS_OTP_DEV_MODE', 'SMS_OTP_ENABLED', 'JWT_SECRET', 'MASTER_KEY',
] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe('environment-sensitive security defaults', () => {
  it('gates development OTP bypasses using NODE_ENV loaded after module import', async () => {
    delete process.env.NODE_ENV;
    process.env.TOTP_ACCEPT_ANY_CODE = 'true';
    process.env.SMS_OTP_DEV_MODE = 'true';
    vi.resetModules();
    const { loadConfig } = await import('../src/config.js');

    // Mirrors index.ts: the module imports before .env is loaded.
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-jwt-secret-with-32-bytes-minimum';
    process.env.MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    const config = loadConfig();

    expect(config.nodeEnv).toBe('production');
    expect(config.isDev).toBe(false);
    expect(config.totp.acceptAnyCode).toBe(false);
    expect(config.demoAccountsEnabled).toBe(false);
    expect(config.sms.devMode).toBe(false);
    expect(config.sms.enabled).toBe(false);
  });

  it('enables demo accounts only with the development OTP bypass', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TOTP_ACCEPT_ANY_CODE = 'true';
    delete process.env.DEMO_ACCOUNTS_ENABLED;
    vi.resetModules();
    const { loadConfig } = await import('../src/config.js');

    expect(loadConfig().demoAccountsEnabled).toBe(true);

    process.env.DEMO_ACCOUNTS_ENABLED = 'false';
    expect(loadConfig().demoAccountsEnabled).toBe(false);
  });

  it('rejects production startup without persistent secrets', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.MASTER_KEY;
    vi.resetModules();
    const { loadConfig } = await import('../src/config.js');

    expect(() => loadConfig()).toThrow('JWT_SECRET must be set');
  });

  it('rejects a production master key shorter than 32 decoded bytes', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-jwt-secret-with-32-bytes-minimum';
    process.env.MASTER_KEY = Buffer.alloc(16, 7).toString('base64');
    vi.resetModules();
    const { loadConfig } = await import('../src/config.js');

    expect(() => loadConfig()).toThrow('MASTER_KEY must be valid base64');
  });
});
