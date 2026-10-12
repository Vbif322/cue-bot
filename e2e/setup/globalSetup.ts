import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { startMigratedPostgres } from '../../test/setup/postgres.js';
import {
  ADMIN_PORT,
  ADMIN_URL,
  API_PORT,
  API_URL,
  APP_PORT,
  APP_URL,
  ARTIFACTS_DIR,
  E2E_JWT_SECRET,
  ROOT_DIR,
  SERVER_LOG,
} from '../env.js';

const READY_TIMEOUT_MS = 90_000;

/** Set by teardown so the SIGTERM exits it causes aren't reported as crashes. */
let stopping = false;

/** Spawn in its own process group so teardown can kill the whole tree. */
function launch(
  name: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logFile: string,
): ChildProcess {
  const out = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, args, {
    cwd: ROOT_DIR,
    env,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.on('exit', (code, signal) => {
    if (!stopping && (code !== 0 || signal !== null)) {
      console.error(
        `[e2e] ${name} exited (${String(code ?? signal)}), see ${logFile}`,
      );
    }
  });
  return child;
}

function kill(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

/** Resolve once `url` answers with any HTTP status (the server is listening). */
async function waitForHttp(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${url}: process exited before becoming ready`);
    }
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`${url} did not come up in ${String(READY_TIMEOUT_MS)}ms`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const { container, url } = await startMigratedPostgres();

  // Inherited by the test workers: they seed via db.ts and mint auth cookies.
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = E2E_JWT_SECRET;
  process.env.BOT_TOKEN = 'e2e-fake-token';

  const children: ChildProcess[] = [];
  const teardown = async (): Promise<void> => {
    stopping = true;
    children.forEach(kill);
    await container.stop();
  };

  try {
    const api = launch(
      'api',
      [path.join(ROOT_DIR, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'],
      {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: url,
        ADMIN_PORT: String(API_PORT),
        JWT_SECRET: E2E_JWT_SECRET,
        BOT_TOKEN: 'e2e-fake-token',
        BOT_DISABLED: '1',
        // Empty SMTP_HOST → mailService's jsonTransport logs the code to stdout.
        SMTP_HOST: '',
      },
      SERVER_LOG,
    );
    children.push(api);
    const ready = [waitForHttp(`${API_URL}/api/app/auth/me`, api)];

    const vite = path.join(ROOT_DIR, 'node_modules/vite/bin/vite.js');
    const viteEnv = { ...process.env, VITE_API_PROXY: API_URL };
    for (const [name, port, url] of [
      ['admin', ADMIN_PORT, ADMIN_URL],
      ['app', APP_PORT, APP_URL],
    ] as const) {
      const spa = launch(
        name,
        [
          vite,
          '--config',
          `${name}/vite.config.ts`,
          name,
          '--port',
          String(port),
          '--strictPort',
        ],
        viteEnv,
        path.join(ARTIFACTS_DIR, `${name}-vite.log`),
      );
      children.push(spa);
      ready.push(waitForHttp(url, spa));
    }

    await Promise.all(ready);
  } catch (e) {
    await teardown();
    throw e;
  }

  return teardown;
}
