# Using JARVIS away from home

Nothing is exposed to the internet and nothing is port-forwarded. Away from home the MacBook reaches the PC through **Tailscale**, a private encrypted network between your own devices. Without it, JARVIS works on your home network only.

## What has to be true

| Requirement | Why |
|---|---|
| The PC is **on and awake** (not asleep, not shut down) | The model, the server and the approvals run there. |
| LM Studio is running with the model loaded | Chat needs the model. |
| `npm run server` and `npm run agent` are running (or installed to start at logon) | The Mac connects to them. |
| Tailscale is installed and signed in **on both** machines, same account | The private link. |
| The Mac agent is running on the Mac, if you want JARVIS to control the Mac | It is separate from the browser tab. |

Wake-on-LAN does not work from outside the house on its own. If the PC is off, it stays off until you are home, unless something else on your home network can send the packet.

## One-time setup (about 15 minutes)

1. **Install Tailscale** on the PC and on the Mac (tailscale.com/download), sign in with the same account on both. Note each machine's name in the Tailscale app (for example `pc` and `mac`; keep them short).
2. **PC: keep it awake while plugged in.** In an admin PowerShell:
   ```
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```
3. **PC: start JARVIS at logon.** `node scripts/install.js --os win32` (preview), then `--apply`. It prints the firewall rule; run it in an admin PowerShell. The rule allows port 7410 only from Tailscale addresses (`100.64.0.0/10`).
4. **PC: HTTPS for the browser** (needed for the microphone, optional otherwise):
   ```
   tailscale serve --bg 7410
   ```
   This gives the PC a private `https://pc.<your-tailnet>.ts.net` address that only your devices can open.
5. **Both machines: use the Tailscale names in the config.** On the PC, in `config\server\machines.json`, set `machines.mac.host` to the Mac's Tailscale name. On the Mac, set `server.url` to `http://<PC Tailscale name>:7410`. Restart the server and the Mac agent.
6. **Mac: start the agent at login** (`node scripts/install.js --os darwin --apply`) and, in System Settings > Battery or Energy, allow it to stay reachable (prevent automatic sleeping when plugged in, or use the `keep_awake` action).
7. **Get the links** on the PC: `node scripts/client-link.js`. It prints a home link and, when Tailscale is running, an away link. Open the away link in any browser on the Mac. Do not paste these links anywhere: they contain your token.

## Checking it

- On the PC: `node scripts/doctor.js` shows a Tailscale line and every agent.
- On the Mac, turn Wi-Fi off and use a phone hotspot: the away link should still connect (Settings shows Connected).
- Send a message, then switch to Mac in the switcher and ask for something small.

## Security notes

- Tailscale encrypts everything between your devices. Plain `http://` over Tailscale is encrypted by Tailscale itself; HTTPS through `tailscale serve` additionally lets the browser use the microphone.
- The token is still required for every request. If a link leaks, rotate it: `node scripts/gen-tokens.js --rotate ui`, restart the server, get a new link.
- In Tailscale's admin page you can restrict which devices may reach the PC (access controls). Allowing only the Mac to reach port 7410 on the PC is a good rule.
- Lose or sell the Mac: remove it from the Tailscale device list and rotate the tokens.
- Behind `tailscale serve` every request reaches JARVIS from the loopback address, so the failed-login limit cannot tell callers apart; the token strength (256 bits) is what protects you.

## Limits

- The Mac agent is offline when the Mac is asleep or closed. JARVIS then says the Mac is not reachable and does not fall back to the PC.
- Voice needs HTTPS (step 4) in the browser.
- Large changes on a slow connection feel slower, but chat is only text.
