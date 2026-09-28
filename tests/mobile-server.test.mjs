import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDevServer } from '../tools/dev-server.mjs';
import { mobileServerConfig } from '../tools/mobile-server-config.mjs';

async function serve(t, options = {}) {
  const server = createDevServer({ automaticTicks: false, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (host, origin) => new Promise((resolve, reject) => {
    const port = server.address().port;
    http.get({ hostname: '127.0.0.1', port, path: '/health', headers: {
      Host: host + ':' + port, ...(origin ? { Origin: origin.replace('{port}', port) } : {})
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }).on('error', reject);
  });
}

test('LAN access is opt-in and preserves exact Host and browser Origin checks', async t => {
  const local = await serve(t);
  assert.equal(await local('127.0.0.1'), 200);
  assert.equal(await local('192.168.1.22'), 403);
  const lan = await serve(t, { lanHost: '192.168.1.22' });
  assert.equal(await lan('192.168.1.22'), 200);
  assert.equal(await lan('192.168.1.22', 'http://192.168.1.22:{port}'), 200);
  assert.equal(await lan('192.168.1.23'), 403);
  assert.equal(await lan('192.168.1.22', 'http://evil.example'), 403);
  assert.equal(await lan('192.168.1.22.evil.example'), 403);
});

test('LAN configuration rejects wildcard and public addresses before creating a server', () => {
  for (const lanHost of ['0.0.0.0', '8.8.8.8', '*', '192.168.1.2:7351', 'https://192.168.1.2']) {
    assert.throws(() => createDevServer({ automaticTicks: false, lanHost }), /LAN/);
  }
});

test('environment configuration binds only the selected interface and validates its port', () => {
  assert.deepEqual(mobileServerConfig({}), { lanHost: null, bindHost: '127.0.0.1', port: 7351,
    allowedHosts: ['127.0.0.1', 'localhost'] });
  for (const address of ['10.0.0.2', '172.16.0.5', '172.31.255.2', '192.168.0.15']) {
    const config = mobileServerConfig({ TOWERDEF_LAN_HOST: address, PORT: '7360' });
    assert.equal(config.bindHost, address);
    assert.equal(config.port, 7360);
    assert.deepEqual(config.allowedHosts, ['127.0.0.1', 'localhost', address]);
  }
  for (const address of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '10.0.0.999']) {
    assert.throws(() => mobileServerConfig({ TOWERDEF_LAN_HOST: address }), /LAN/);
  }
  for (const port of ['0', '-1', '65536', 'abc', '7351.5']) assert.throws(() => mobileServerConfig({ PORT: port }), /PORT/);
});
