// Wake-on-LAN: the magic packet (6 x 0xFF, then the MAC 16 times) sent as a UDP broadcast. Shared by the agent's
// wake_on_lan action, the home relay (scripts/wake-relay.js) and the wake command (scripts/wake.js).
import dgram from 'node:dgram';

export const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

export function wolPacket(mac) {
  if (!MAC_RE.test(mac)) throw new Error('MAC address must look like aa:bb:cc:dd:ee:ff');
  const bytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

// Sends to the limited broadcast and to each extra address given (a directed broadcast such as 192.168.1.255).
export function sendWol(mac, { extra = [] } = {}) {
  const packet = wolPacket(mac);
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', (e) => { s.close(); reject(e); });
    s.bind(() => {
      s.setBroadcast(true);
      const targets = ['255.255.255.255', ...extra];
      let left = targets.length;
      let failed = null;
      for (const t of targets) {
        s.send(packet, 9, t, (e) => { if (e) failed = e; if (--left === 0) { s.close(); failed ? reject(failed) : resolve(); } });
      }
    });
  });
}
