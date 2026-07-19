import { readFile } from 'node:fs/promises';
import process from 'node:process';
import vm from 'node:vm';

/**
 * Executes the production CommonJS bundle with all browser network surfaces monitored and blocked.
 * The Obsidian host is represented by inert constructable values because this gate verifies module
 * initialization, not host UI behavior. The separate offline Vitest command exercises workflows.
 */
const bundlePath = new URL('../main.js', import.meta.url);
const bundle = await readFile(bundlePath, 'utf8');
const attempts = [];
const blocked = (capability) =>
  function blockedNetworkCapability(...arguments_) {
    attempts.push({ capability, argumentCount: arguments_.length });
    throw new Error(`Production bundle attempted ${capability}.`);
  };

class InertHostClass {}
const inertHostValue = new Proxy(InertHostClass, {
  apply: () => undefined,
  construct: () => Object.create(null),
  get: (target, property) =>
    property === 'prototype'
      ? target.prototype
      : property === Symbol.toStringTag
        ? 'Function'
        : false
});
const obsidian = new Proxy(Object.create(null), {
  get: () => inertHostValue
});
const module = { exports: {} };
const sandbox = {
  AbortController,
  Array,
  BigInt,
  Boolean,
  Date,
  Error,
  Intl,
  JSON,
  Map,
  Math,
  Number,
  Object,
  Promise,
  RegExp,
  Set,
  String,
  Symbol,
  TextDecoder,
  TextEncoder,
  URL,
  URLSearchParams,
  clearInterval,
  clearTimeout,
  console,
  exports: module.exports,
  fetch: blocked('fetch'),
  module,
  navigator: { sendBeacon: blocked('navigator.sendBeacon') },
  queueMicrotask,
  require: (specifier) => {
    if (specifier === 'obsidian') return obsidian;
    throw new Error(`Production bundle requested unexpected module ${JSON.stringify(specifier)}.`);
  },
  setInterval,
  setTimeout,
  structuredClone,
  window: {
    EventSource: blocked('window.EventSource'),
    WebSocket: blocked('window.WebSocket'),
    fetch: blocked('window.fetch'),
    navigator: { sendBeacon: blocked('window.navigator.sendBeacon') }
  },
  XMLHttpRequest: blocked('XMLHttpRequest'),
  WebSocket: blocked('WebSocket'),
  EventSource: blocked('EventSource')
};
sandbox.globalThis = sandbox;

try {
  const context = vm.createContext(sandbox, { name: 'publishing-manager-offline-audit' });
  new vm.Script(bundle, { filename: 'main.js' }).runInContext(context, { timeout: 5_000 });
} catch (cause) {
  process.stderr.write(
    `Blocked-network production runtime verification failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`
  );
  process.exitCode = 1;
}

if (attempts.length > 0) {
  process.stderr.write(
    `Production bundle made blocked network attempts: ${JSON.stringify(attempts)}\n`
  );
  process.exitCode = 1;
} else if (process.exitCode !== 1) {
  process.stdout.write(
    'Blocked-network production runtime verification passed: bundle initialization made 0 attempts.\n'
  );
}
