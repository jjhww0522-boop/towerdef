import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function progressionFilePath(env = process.env, projectRoot = fileURLToPath(new URL('../', import.meta.url))) {
  const directory = env.TOWERDEF_DATA_DIR || (env.TOWERDEF_LAN_HOST ? '.towerdef-data/mobile' : '.towerdef-data');
  return resolve(projectRoot, directory, 'profiles.json');
}

// Development-only LAN exposure is an explicit private IPv4, never a wildcard.
export function mobileServerConfig(env = process.env) {
  const lanHost = env.TOWERDEF_LAN_HOST || null;
  if (lanHost) {
    const parts = lanHost.split('.').map(Number);
    if (isIP(lanHost) !== 4 || !(parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168))) {
      throw new Error('TOWERDEF_LAN_HOST must be an explicit private LAN IPv4 address.');
    }
  }
  const port = Number(env.PORT || 7351);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  return { lanHost, bindHost: lanHost || '127.0.0.1', port,
    allowedHosts: ['127.0.0.1', 'localhost', ...(lanHost ? [lanHost] : [])] };
}
