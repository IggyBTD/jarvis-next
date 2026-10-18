// Placeholder until the browser phase (P8) replaces it: reports "not started" and never proxies.
import { EventEmitter } from 'node:events';
export function createBrowserManager() {
  return { start: async () => false, stop: async () => {}, status: () => ({ running: false, error: 'not built yet' }), events: new EventEmitter() };
}
