import { afterEach, describe, expect, it, vi } from 'vitest';

const environmentKeys = ['NODE_ENV', 'TOTP_ACCEPT_ANY_CODE', 'SMS_OTP_DEV_MODE'] as const;
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
    const config = loadConfig();

    expect(config.nodeEnv).toBe('production');
    expect(config.isDev).toBe(false);
    expect(config.totp.acceptAnyCode).toBe(false);
    expect(config.sms.devMode).toBe(false);
  });
});
