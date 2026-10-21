/**
 * Starts the Tyrekick Worker on loopback for local development.
 *
 *   bun scripts/dev-worker.ts --extension-origin chrome-extension://<id> [--local] [--port 8787]
 *
 * Remote mode (default) runs the Worker locally and Workers AI on Cloudflare. It needs
 * Wrangler credentials: CLOUDFLARE_API_TOKEN, or the saved cf CLI OAuth session, which is
 * refreshed with `cf auth whoami` and passed to Wrangler through its process environment.
 * The token is never printed, written to disk, or placed in a command argument.
 * `--local` disables remote bindings, so warning checks report Temporarily unavailable.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const { values } = parseArgs({
  options: {
    'extension-origin': { type: 'string', default: process.env.TYREKICK_EXTENSION_ORIGIN },
    local: { type: 'boolean', default: false },
    port: { type: 'string', default: '8787' },
  },
});

const origin = values['extension-origin'] ?? '';
if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
  console.error('Pass --extension-origin chrome-extension://<32-letter id> (see chrome://extensions).');
  process.exit(2);
}
if (!/^\d{2,5}$/.test(values.port)) {
  console.error('--port must be a number');
  process.exit(2);
}

const OAuthConfigSchema = z.object({ oauth_token: z.string().min(20) });
const AccountsSchema = z.object({ success: z.literal(true), result: z.array(z.object({ id: z.string().regex(/^[0-9a-f]{32}$/) })) });

function savedOAuthToken(): string {
  const cf = process.env.TYREKICK_CF_CLI ?? join(homedir(), '.bun', 'bin', 'cf');
  const refresh = spawnSync(cf, ['auth', 'whoami'], { stdio: 'ignore' });
  if (refresh.status !== 0) throw new Error(`\`${cf} auth whoami\` failed; log in with the cf CLI or set CLOUDFLARE_API_TOKEN.`);
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const raw = readFileSync(join(configHome, 'cloudflare', 'config', 'default.json'), 'utf8');
  return OAuthConfigSchema.parse(JSON.parse(raw)).oauth_token;
}

async function onlyAccountId(token: string): Promise<string> {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: { authorization: `Bearer ${token}` } });
  const accounts = AccountsSchema.parse(await response.json()).result;
  const [account] = accounts;
  if (accounts.length !== 1 || !account) throw new Error('Set CLOUDFLARE_ACCOUNT_ID: the token can see more than one account.');
  return account.id;
}

const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
if (!values.local) {
  env.CLOUDFLARE_API_TOKEN ??= savedOAuthToken();
  env.CLOUDFLARE_ACCOUNT_ID ??= await onlyAccountId(env.CLOUDFLARE_API_TOKEN);
}

const root = join(import.meta.dir, '..');
const args = [
  'dev',
  '--config',
  join(root, 'server', 'wrangler.jsonc'),
  '--ip',
  '127.0.0.1',
  '--port',
  values.port,
  '--var',
  'TYREKICK_ENV:development',
  '--var',
  `ALLOWED_EXTENSION_ORIGIN:${origin}`,
  '--show-interactive-dev-session=false',
  ...(values.local ? ['--local'] : []),
];
const child = spawn(join(root, 'node_modules', '.bin', 'wrangler'), args, { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
