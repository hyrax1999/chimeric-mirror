import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const resources = dirname(fileURLToPath(import.meta.url));
const isApp = resources.endsWith('/Contents/Resources');
const productRoot = isApp ? resolve(resources, '../../..') : resources;
const defaultPort = 18868;

export function parseArgs(argv = []) {
  let action;
  let profileArgument;
  let portArgument;
  const positional = [];
  const setOption = (name, value) => {
    if (value === undefined || value === '' || value.startsWith('-')) throw new Error(`Missing value for --${name}.`);
    if (name === 'profile') {
      if (profileArgument !== undefined) throw new Error('The --profile option may only be supplied once.');
      profileArgument = value;
    } else {
      if (portArgument !== undefined) throw new Error('The --port option may only be supplied once.');
      portArgument = value;
    }
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--profile' || token === '--port') { setOption(token.slice(2), argv[++index]); continue; }
    if (token.startsWith('--profile=')) { setOption('profile', token.slice(10)); continue; }
    if (token.startsWith('--port=')) { setOption('port', token.slice(7)); continue; }
    if (token === '-h' || token === '--help') {
      if (action && action !== 'help') throw new Error('Multiple actions were supplied.');
      action = 'help'; continue;
    }
    if (token === '--version') {
      if (action && action !== 'version') throw new Error('Multiple actions were supplied.');
      action = 'version'; continue;
    }
    if (token.startsWith('-')) throw new Error(`Unknown Chimeric option: ${token}`);
    positional.push(token);
  }
  if (positional.length > 1 || (positional.length && action)) throw new Error('Multiple actions were supplied.');
  action = action ?? positional[0] ?? 'open';
  if (!new Set(['open', 'session', 'url', 'serve', 'daemon', 'status', 'stop', 'help', 'version']).has(action)) throw new Error(`Unknown Chimeric action: ${action}`);
  if (portArgument !== undefined && (!/^\d+$/.test(portArgument) || Number(portArgument) < 1024 || Number(portArgument) > 65534)) throw new Error('Choose a port between 1024 and 65534.');
  return { action, profileArgument, portArgument };
}

export function redacted(value) {
  return String(value).split(/\r?\n/).filter((line) => !/(?:nonce|access_token|refresh_token|auth\/login|login link|authorization:\s*Bearer)/i.test(line)).join('\n')
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/\?[^\s"']+/gi, '[REDACTED_SESSION_URL]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
}

export function validateSessionUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('The runtime did not return a session URL.');
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error('The runtime returned an invalid session URL.'); }
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('The session URL must use loopback HTTP.');
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.hash || parsed.searchParams.size !== 1 || !parsed.searchParams.has('nonce')) throw new Error('The runtime returned an invalid session URL.');
  const nonce = parsed.searchParams.get('nonce');
  if (!nonce || !/^[a-f0-9]{16,}$/i.test(nonce)) throw new Error('The runtime returned an invalid session nonce.');
  const port = Number(parsed.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The runtime returned an invalid session port.');
  parsed.hostname = '127.0.0.1';
  return parsed.toString();
}

function readConfig(configFile, explicit) {
  if (explicit || !existsSync(configFile)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('configuration must be an object');
    if (parsed.profile !== undefined && (typeof parsed.profile !== 'string' || !parsed.profile.trim())) throw new Error('profile must be a non-empty string');
    if (parsed.port !== undefined && (!/^\d+$/.test(String(parsed.port)) || Number(parsed.port) < 1024 || Number(parsed.port) > 65534)) throw new Error('port must be between 1024 and 65534');
    return parsed;
  }
  catch (error) { throw new Error(`Could not read ${configFile}: ${error instanceof Error ? error.message : String(error)}`); }
}
function defaultProfileFor(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return join(homedir(), 'Library/Application Support/Chimeric');
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Chimeric');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'chimeric');
}
function resolveSettings(parsed) {
  const env = process.env;
  const config = readConfig(join(productRoot, 'chimeric.local.json'), parsed.profileArgument !== undefined && parsed.portArgument !== undefined);
  const profile = resolve(parsed.profileArgument ?? env.CHIMERIC_DATA_DIR ?? config.profile ?? defaultProfileFor(process.platform, env));
  const port = Number(parsed.portArgument ?? env.CHIMERIC_PORT ?? config.port ?? defaultPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('Choose a port between 1024 and 65534.');
  return { profile, port };
}
function runtimePaths() {
  const packaged = join(resources, 'bin', process.platform === 'win32' ? 'chimeric.exe' : 'chimeric');
  const override = process.env.CHIMERIC_RUNTIME_BINARY;
  if (override && !existsSync(override)) throw new Error(`CHIMERIC_RUNTIME_BINARY does not exist: ${override}`);
  if (!override && !existsSync(packaged)) throw new Error(`Packaged Chimeric runtime is missing: ${packaged}`);
  return { binary: override || packaged, entry: join(resources, 'runtime', 'chimeric.js') };
}
function childEnvironment(profile) {
  const env = { ...process.env, BUN_BE_BUN: '1', SCIENCE_LOCAL_PROFILE: profile };
  delete env.SCIENCE_PROVIDER_CONFIG; delete env.SCIENCE_ASSET_MANIFEST;
  return env;
}
async function invokeRuntime(paths, env, profile, command) {
  const child = Bun.spawn([paths.binary, paths.entry, ...command, '--data-dir', profile], { env, stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch {} }, 10_000);
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  if (timedOut) return { stdout, stderr: `${stderr}\nRuntime command timed out after 10 seconds.`, code: 124 };
  return { stdout, stderr, code };
}
async function sessionFromRuntime(paths, env, profile) {
  const result = await invokeRuntime(paths, env, profile, ['url']);
  const matches = result.stdout.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/\?nonce=[a-f0-9]+/gi) ?? [];
  return matches.length ? validateSessionUrl(matches.at(-1)) : null;
}
async function ensureWorkspace(paths, env, profile, port) {
  let url = await sessionFromRuntime(paths, env, profile);
  if (url) return url;
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  const parent = Bun.spawn([paths.binary, fileURLToPath(import.meta.url), 'daemon', '--profile', profile, '--port', String(port)], { env, stdout: 'ignore', stderr: 'ignore', stdin: 'ignore', detached: true });
  parent.unref();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { await new Promise((delay) => setTimeout(delay, 500)); url = await sessionFromRuntime(paths, env, profile); if (url) return url; }
  throw new Error('Chimeric did not become ready within 60 seconds. Read chimeric-launcher.log in the private profile.');
}
async function openBrowser(url) {
  const command = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url];
  const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' });
  const error = await new Response(child.stderr).text();
  if (await child.exited !== 0) throw new Error(`Could not open the browser: ${redacted(error)}`);
}
async function run(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.action === 'help') { console.log('Chimeric\n\nUsage: chimeric [open|session|url|serve|daemon|status|stop|help|version] [--profile DIRECTORY] [--port PORT]'); return; }
  if (parsed.action === 'version') { console.log('Chimeric development build · research runtime 0.1.71'); return; }
  const { profile, port } = resolveSettings(parsed); const paths = runtimePaths(); const env = childEnvironment(profile);
  if (parsed.action === 'serve' || parsed.action === 'daemon') {
    mkdirSync(profile, { recursive: true, mode: 0o700 }); const log = join(profile, 'chimeric-launcher.log'); appendFileSync(log, '[Chimeric] starting local workspace\n', { mode: 0o600 }); chmodSync(log, 0o600);
    const child = Bun.spawn([paths.binary, paths.entry, 'serve', '--data-dir', profile, '--port', String(port), '--sandbox-port', String(port + 1), '--no-auto-update', '--no-browser'], { env, stdout: 'pipe', stderr: 'pipe' });
    const relay = async (stream) => { let pending = ''; for await (const bytes of stream) { pending += new TextDecoder().decode(bytes, { stream: true }); const lines = pending.split('\n'); pending = lines.pop(); const clean = redacted(lines.join('\n')); if (clean) { appendFileSync(log, `${clean}\n`); if (parsed.action === 'serve') process.stdout.write(`${clean}\n`); } } const clean = redacted(pending); if (clean) appendFileSync(log, `${clean}\n`); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGINT')); await Promise.all([relay(child.stdout), relay(child.stderr)]); process.exitCode = await child.exited; return;
  }
  if (parsed.action === 'status' || parsed.action === 'stop') { const result = await invokeRuntime(paths, env, profile, [parsed.action]); if (result.stdout.trim()) console.log(redacted(result.stdout)); if (result.stderr.trim()) console[result.code ? 'error' : 'log'](redacted(result.stderr)); process.exitCode = result.code; return; }
  const url = await ensureWorkspace(paths, env, profile, port);
  if (parsed.action === 'url') { console.error('Session URL is one-use; keep it private.'); console.log(url); return; }
  if (parsed.action === 'session') { console.log(JSON.stringify({ url, profile, origin: new URL(url).origin })); return; }
  await openBrowser(url); console.log(`Opened Chimeric at ${new URL(url).origin}/`);
}

if (import.meta.main) run().catch((error) => { console.error(redacted(error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
