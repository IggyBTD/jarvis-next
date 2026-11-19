# Network

Preferred: Tailscale on both machines (encrypted end to end, stable names `pc` and `mac`, works away from home, nothing forwarded). Port forwarding to the internet is rejected: never do it.

- The server binds `auto`: the Tailscale interface if there is one, else the LAN address, else loopback (the log says which).
- Windows firewall: allow inbound TCP 7410 only, scoped to `100.64.0.0/10` (Tailscale). The commands are printed by `node scripts/install.js --os win32`, never run for you. The PC agent listens on localhost only.
- Without Tailscale: scope the rule to the LAN (`192.168.0.0/16`). This is a weaker guarantee: plain HTTP and WebSocket are readable by anyone on that network, and the bearer token travels in the clear. Use it only on a network you trust.
- Every route needs a bearer token. Browser clients also need an allowed Origin. Agents accept only the server's address (`allowedCallers`) and the token of their own machine.
- OpenCode on the Mac talks to `<server>/v1` with a token derived from the Mac's token that opens only that route. It never reaches LM Studio directly.
- Wake-on-LAN needs it enabled in the BIOS and the network adapter, and the PC's MAC address entered in Settings. The desktop app sends the packet.
