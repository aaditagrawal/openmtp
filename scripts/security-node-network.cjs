'use strict';

// Run with the actual Electron binary in ELECTRON_RUN_AS_NODE mode. This is
// deliberately separate from Bun's tests: it exercises Electron's Node APIs.
// All DNS and TLS traffic stays on loopback. No external services are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const dns = require('node:dns');
const tls = require('node:tls');
const https = require('node:https');
const dgram = require('node:dgram');

const unprotected = process.argv.includes('--unprotected-negative-control');
const ambiguous = [
  '0177.0.0.1',
  '0x7f.0.0.1',
  '2130706433',
  '127.1',
  '\uFF11\uFF12\uFF17.0.0.1',
  '127\u30020.0.1',
];
const methods = [
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTlsa',
  'resolveTxt',
];

async function main() {
  // Create ESM namespaces before installation to check live named exports.
  const esmDns = await import('node:dns');
  const esmPromises = await import('node:dns/promises');
  const esmTls = await import('node:tls');
  const trustBefore = {
    roots: [...tls.rootCertificates],
    connect: tls.connect,
    createSecureContext: tls.createSecureContext,
    minVersion: tls.DEFAULT_MIN_VERSION,
  };
  if (!unprotected) require('../app/security/node-network.cjs');
  assert.deepEqual(tls.rootCertificates, trustBefore.roots);
  assert.equal(tls.connect, trustBefore.connect);
  assert.equal(tls.createSecureContext, trustBefore.createSecureContext);
  assert.equal(tls.DEFAULT_MIN_VERSION, trustBefore.minVersion);

  const numericCert = { subjectaltname: 'DNS:127.0.0.1', subject: {} };
  for (const host of ambiguous) {
    assert.equal(
      Boolean(tls.checkServerIdentity(host, numericCert)),
      !unprotected,
    );
    assert.equal(
      Boolean(esmTls.checkServerIdentity(host, numericCert)),
      !unprotected,
    );
    // An IP SAN must not make ambiguous spelling acceptable either.
    if (!unprotected)
      assert.equal(
        Boolean(
          tls.checkServerIdentity(host, {
            subjectaltname: 'IP Address:127.0.0.1',
          }),
        ),
        true,
      );
  }
  for (const [host, san] of [
    ['localhost', 'DNS:localhost'],
    ['example.test.', 'DNS:example.test'],
    ['b.example.test', 'DNS:*.example.test'],
    ['127.0.0.1', 'IP Address:127.0.0.1'],
    ['::1', 'IP Address:::1'],
    ['2001:db8::1', 'IP Address:2001:DB8:0:0:0:0:0:1'],
    ['xn--bcher-kva.example.test', 'DNS:xn--bcher-kva.example.test'],
  ])
    assert.equal(
      tls.checkServerIdentity(host, { subjectaltname: san }),
      undefined,
    );
  assert.equal(
    tls.checkServerIdentity('other.test', numericCert).code,
    'ERR_TLS_CERT_ALTNAME_INVALID',
  );

  // Substitute only the native DNS query boundary. Canonical inputs must reach
  // it; NUL inputs must not. No network query can escape this matrix.
  const channel = process.binding('cares_wrap').ChannelWrap.prototype;
  const sentinel = new Error('TEST_NATIVE_DNS_BOUNDARY');
  const originals = new Map();
  let attempts = 0;
  for (const name of Object.getOwnPropertyNames(channel).filter((n) =>
    n.startsWith('query'),
  )) {
    originals.set(name, channel[name]);
    channel[name] = () => {
      attempts++;
      throw sentinel;
    };
  }
  let matrixChecks = 0;
  try {
    for (const [resolver, promiseAPI] of [
      [dns, false],
      [new dns.Resolver(), false],
      [dns.promises, true],
      [new dns.promises.Resolver(), true],
      [esmDns, false],
      [esmPromises, true],
    ]) {
      for (const method of methods) {
        const invoke = (name) =>
          promiseAPI
            ? resolver[method](name)
            : resolver[method](name, () => {});
        const before = attempts;
        let canonicalError;
        try {
          await invoke('example.test');
        } catch (error) {
          canonicalError = error;
        }
        assert.equal(canonicalError, sentinel);
        if (unprotected) {
          let nulError;
          try {
            await invoke('example.test\0.trusted.test');
          } catch (error) {
            nulError = error;
          }
          assert.equal(nulError, sentinel);
        } else {
          assert.throws(() => invoke('example.test\0.trusted.test'), {
            code: 'ERR_INVALID_ARG_VALUE',
          });
        }
        assert.equal(attempts, before + (unprotected ? 2 : 1));
        matrixChecks++;
      }
    }
    if (!unprotected) {
      for (const resolver of [
        dns,
        new dns.Resolver(),
        dns.promises,
        new dns.promises.Resolver(),
      ]) {
        for (const rrtype of [
          'A',
          'AAAA',
          'ANY',
          'CAA',
          'CNAME',
          'MX',
          'NAPTR',
          'NS',
          'PTR',
          'SOA',
          'SRV',
          'TLSA',
          'TXT',
        ])
          assert.throws(
            () => resolver.resolve('example.test\0.bad', rrtype, () => {}),
            { code: 'ERR_INVALID_ARG_VALUE' },
          );
        assert.throws(() => resolver.reverse('127.0.0.1\0.bad', () => {}), {
          code: 'ERR_INVALID_ARG_VALUE',
        });
      }
      for (const resolver of [
        new dns.Resolver(),
        new dns.promises.Resolver(),
      ]) {
        assert.throws(() => resolver.setLocalAddress('127.0.0.1\0.bad'), {
          code: 'ERR_INVALID_ARG_VALUE',
        });
        assert.throws(
          () => resolver.setLocalAddress('127.0.0.1', '::1\0.bad'),
          { code: 'ERR_INVALID_ARG_VALUE' },
        );
        resolver.setLocalAddress('127.0.0.1', '::1');
      }
    }
  } finally {
    for (const [name, original] of originals) channel[name] = original;
  }

  const udp = dgram.createSocket('udp4');
  const queries = [];
  udp.on('message', (query, peer) => {
    queries.push(query.toString('hex'));
    const header = Buffer.from(query.subarray(0, 12));
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 6);
    const answer = Buffer.from([
      0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, 127, 0, 0, 7,
    ]);
    udp.send(
      Buffer.concat([header, query.subarray(12), answer]),
      peer.port,
      peer.address,
    );
  });
  udp.bind(0, '127.0.0.1');
  await once(udp, 'listening');
  const oldServers = dns.getServers();
  try {
    const servers = [`127.0.0.1:${udp.address().port}`];
    const r = new dns.Resolver();
    const p = new dns.promises.Resolver();
    for (const api of [dns, dns.promises, r, p]) api.setServers(servers);
    const callbackQuery = (api, name) =>
      new Promise((resolve, reject) =>
        api.resolve4(name, (error, result) =>
          error ? reject(error) : resolve(result),
        ),
      );
    // Rebinding must preserve both cached CJS functions and ESM named exports.
    const cached = { resolve4: dns.resolve4 };
    const cases = [
      (api) => callbackQuery(api, 'example.test'),
      (api) => api.resolve4('example.test'),
    ];
    for (const api of [dns, r, cached, ...(unprotected ? [] : [esmDns])])
      assert.deepEqual(await cases[0](api), ['127.0.0.7']);
    for (const api of [dns.promises, p, ...(unprotected ? [] : [esmPromises])])
      assert.deepEqual(await cases[1](api), ['127.0.0.7']);
    const before = queries.length;
    if (unprotected) {
      assert.deepEqual(
        await callbackQuery(dns, 'example.test\0.trusted.test'),
        ['127.0.0.7'],
      );
      assert.equal(queries.length, before + 1);
    } else {
      for (const api of [dns, r, cached, esmDns, dns.promises, p, esmPromises])
        assert.throws(
          () => api.resolve4('example.test\0.trusted.test', () => {}),
          { code: 'ERR_INVALID_ARG_VALUE' },
        );
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(queries.length, before);
    }
  } finally {
    dns.setServers(oldServers);
    udp.close();
  }

  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), 'openmtp-network-test-'),
  );
  let server;
  try {
    const keyPath = path.join(fixture, 'key.pem');
    const certPath = path.join(fixture, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=OpenMTP offline test',
        '-addext',
        'subjectAltName=DNS:localhost,DNS:127.0.0.1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { stdio: 'ignore' },
    );
    fs.chmodSync(keyPath, 0o600);
    const cert = fs.readFileSync(certPath);
    server = https.createServer(
      { key: fs.readFileSync(keyPath), cert },
      (_req, res) => res.end('offline-ok'),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const lookup = (_host, _options, callback) =>
      callback(null, '127.0.0.1', 4);
    const options = (host) => ({
      host,
      port,
      ca: cert,
      lookup,
      family: 4,
      autoSelectFamily: false,
    });
    const connect = (opts) =>
      new Promise((resolve, reject) => {
        const socket = tls.connect(opts, () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
    await connect(options('localhost'));
    for (const host of ambiguous) {
      if (unprotected) await connect(options(host));
      else
        await assert.rejects(connect(options(host)), {
          code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
    }
    await assert.rejects(connect(options('other.test')), {
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
    await assert.rejects(connect({ ...options('localhost'), ca: undefined }));
    const request = (host) =>
      new Promise((resolve, reject) => {
        const req = https.get({ ...options(host), agent: false }, (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve(body));
        });
        req.once('error', reject);
      });
    assert.equal(await request('localhost'), 'offline-ok');
    if (unprotected) assert.equal(await request('127.1'), 'offline-ok');
    else
      await assert.rejects(request('127.1'), {
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      });
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.info(
    JSON.stringify({
      ok: true,
      mode: unprotected ? 'affected negative control' : 'application hardened',
      node: process.versions.node,
      electron: process.versions.electron,
      dnsMatrixChecks: matrixChecks,
      actualLoopbackDnsQueries: queries.length,
      tlsAmbiguousHosts: ambiguous.length,
      realTLSAndHTTPS: true,
      esmAndCachedCJS: true,
      externalNetworkRequired: false,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
