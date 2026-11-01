import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ports and URLs of the e2e stack. Deliberately off the dev defaults
 * (3000 / 5173 / 5174) so `npm run dev:all` can keep running alongside.
 */
export const API_PORT = 3100;
export const ADMIN_PORT = 5183;
export const APP_PORT = 5184;

export const API_URL = `http://localhost:${String(API_PORT)}`;
export const ADMIN_URL = `http://localhost:${String(ADMIN_PORT)}`;
export const APP_URL = `http://localhost:${String(APP_PORT)}`;

/** Shared by the API process (signs) and the test workers (mint cookies). */
export const E2E_JWT_SECRET = 'e2e-secret';

export const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const ARTIFACTS_DIR = path.join(ROOT_DIR, 'e2e', '.artifacts');
/** API stdout+stderr; the dev mailer prints login codes here. */
export const SERVER_LOG = path.join(ARTIFACTS_DIR, 'server.log');
