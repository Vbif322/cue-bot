import { afterEach, describe, expect, it } from 'vitest';

import { assertMailConfigured } from '@/services/mailService.js';

/**
 * Fail-fast почтового окружения. Чистая проверка env — без транспорта и БД,
 * поэтому живёт в unit-проекте. Читает `process.env` в момент вызова, так что
 * достаточно менять его в кейсе и восстанавливать после.
 */
describe('assertMailConfigured', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSmtpHost = process.env.SMTP_HOST;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSmtpHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalSmtpHost;
  });

  it('throws in production when SMTP_HOST is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMTP_HOST;
    expect(() => {
      assertMailConfigured();
    }).toThrow(/SMTP_HOST/);
  });

  it('throws in production when SMTP_HOST is empty', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = '';
    expect(() => {
      assertMailConfigured();
    }).toThrow(/SMTP_HOST/);
  });

  it('passes in production when SMTP_HOST is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.example.com';
    expect(() => {
      assertMailConfigured();
    }).not.toThrow();
  });

  it('passes outside production even without SMTP_HOST (dev jsonTransport)', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SMTP_HOST;
    expect(() => {
      assertMailConfigured();
    }).not.toThrow();
  });
});
