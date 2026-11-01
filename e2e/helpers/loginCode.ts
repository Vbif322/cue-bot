import fs from 'node:fs';

import { expect } from '@playwright/test';

import { must } from '../../test/helpers/must.js';
import { SERVER_LOG } from '../env.js';

/**
 * The e2e API runs without SMTP, so mailService prints every login code to
 * stdout (→ server.log): "Код для <email>: <code>". The mail goes out in the
 * background after the 200, hence the poll. Use a fresh email per test: the
 * log spans the whole run, and the last code for the address wins.
 */
export async function waitForLoginCode(email: string): Promise<string> {
  const pattern = new RegExp(
    `Код для ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (\\d{6})`,
    'g',
  );
  let code: string | undefined;
  await expect
    .poll(
      () => {
        const log = fs.readFileSync(SERVER_LOG, 'utf8');
        code = [...log.matchAll(pattern)].at(-1)?.[1];
        return code;
      },
      { message: `login code for ${email} in ${SERVER_LOG}` },
    )
    .toBeDefined();
  return must(code, `login code for ${email}`);
}
