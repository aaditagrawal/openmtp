'use strict';

// Application-level adaptation of Node v24.22.1's DNS NUL validation and
// non-canonical IP rejection. See patches/SECURITY.md and LICENSE.node.
// Load before application dependencies capture built-in functions.
const dns = require('node:dns');
const tls = require('node:tls');
const { isIP } = require('node:net');
const { domainToASCII } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');

function rejectNullBytes(value, name) {
  if (typeof value === 'string' && value.includes('\0')) {
    const error = new TypeError(
      `The argument '${name}' must be a string without null bytes. Received a string containing null bytes`,
    );
    error.code = 'ERR_INVALID_ARG_VALUE';
    throw error;
  }
}

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
  'reverse',
];

for (const api of [dns, dns.promises]) {
  // The default functions are already bound to a private resolver. Patching
  // only Resolver.prototype leaves those functions unprotected.
  for (const target of [api, api.Resolver.prototype]) {
    for (const method of methods) {
      const original = target[method];
      target[method] = function (name, ...args) {
        rejectNullBytes(name, 'name');
        return Reflect.apply(original, this, [name, ...args]);
      };
    }
  }

  const originalSetLocalAddress = api.Resolver.prototype.setLocalAddress;
  api.Resolver.prototype.setLocalAddress = function (ipv4, ipv6) {
    rejectNullBytes(ipv4, 'ipv4');
    rejectNullBytes(ipv6, 'ipv6');
    return Reflect.apply(originalSetLocalAddress, this, arguments);
  };

  // Node rebinds default functions from the protected prototype on setServers.
  // Refresh existing ESM named exports after that rebinding as well.
  const originalSetServers = api.setServers;
  api.setServers = function (...args) {
    const result = Reflect.apply(originalSetServers, this, args);
    syncBuiltinESMExports();
    return result;
  };
}

const originalCheckServerIdentity = tls.checkServerIdentity;
tls.checkServerIdentity = function (hostname, cert) {
  const host = ('' + hostname).replace(/\.$/, '');
  const ascii = domainToASCII('' + hostname).replace(/\.$/, '');
  if (!isIP(host) && isIP(ascii)) {
    const error = new Error('Host is a non-canonical IP address');
    error.code = 'ERR_TLS_CERT_ALTNAME_INVALID';
    error.reason = 'Host is a non-canonical IP address';
    error.host = host;
    error.cert = cert;
    return error;
  }
  // Retain Electron's SAN/CN parsing, wildcard/IPv6 handling, certificate
  // chain verification and SPKI blocklist. Do not replace TLS or its CA store.
  return originalCheckServerIdentity(hostname, cert);
};

syncBuiltinESMExports();
