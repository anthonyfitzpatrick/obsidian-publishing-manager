/**
 * Installs deterministic network traps before Vitest loads application code. A test-covered path
 * that tries a browser network primitive fails immediately with the attempted capability named.
 */
const blocked = (capability) =>
  function blockedNetworkCapability() {
    throw new Error(`Offline verification blocked unexpected ${capability} access.`);
  };

for (const capability of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'])
  Object.defineProperty(globalThis, capability, {
    configurable: true,
    value: blocked(capability),
    writable: false
  });

const currentNavigator = globalThis.navigator ?? {};
Object.defineProperty(currentNavigator, 'sendBeacon', {
  configurable: true,
  value: blocked('navigator.sendBeacon'),
  writable: false
});
if (globalThis.navigator === undefined)
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: currentNavigator
  });

globalThis.__PUBLISHING_MANAGER_NETWORK_BLOCKED__ = true;
