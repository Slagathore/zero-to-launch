#!/usr/bin/env node
/**
 * `npm run live` — one fluid startup that brings up a public cloudflared tunnel
 * BEFORE the app, then runs the app, so the WHOLE live pipeline (which needs
 * the operator's self-hosted Ollama at localhost:11434) is reachable at a
 * public https URL. Mirrors the DungeonMaster app's tunnel-then-app startup.
 *
 * Topology: cloudflared quick-tunnel  ──►  http://localhost:3000  (this app)
 *                                                    │ server-side
 *                                                    ▼
 *                                          http://localhost:11434 (Ollama)
 *
 * So the public trycloudflare URL is the fully-working app (live model calls
 * and all) whenever this machine is running it. Vercel remains the always-on
 * shell with the seeded/deterministic demos (advertorials, compliance, the
 * seeded run) for when this machine is off.
 *
 * No external deps — plain child_process. (To productionize: swap the ad-hoc
 * spawn/kill for the `procspawn` package's resolveBinary + killTree, which
 * handle Windows PATHEXT + whole-subtree kills.)
 *
 * Requires cloudflared on PATH (https://developers.cloudflare.com/cloudflared).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || "3000";
const ORIGIN = `http://localhost:${PORT}`;
const isWin = process.platform === "win32";
const children = [];
let shuttingDown = false;

// Prefer the NAMED tunnel (stable URL: aideas4ads.cognima.net) when
// cloudflared.yml is present; otherwise fall back to an ephemeral quick tunnel.
const CONFIG_PATH = path.join(process.cwd(), "cloudflared.yml");

function log(msg) {
  process.stdout.write(`\x1b[36m[live]\x1b[0m ${msg}\n`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      if (isWin) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch {
      /* best effort */
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function spawnShell(command, args, opts = {}) {
  const child = spawn(command, args, { shell: true, ...opts });
  children.push(child);
  return child;
}

// 1) Ensure a production build exists (fluid: build once if needed).
if (!existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
  log("no production build found — building once (npm run build)…");
  const build = spawnShell("npm", ["run", "build"], { stdio: "inherit" });
  build.on("exit", (code) => (code === 0 ? startTunnelThenApp() : shutdown(code ?? 1)));
} else {
  startTunnelThenApp();
}

function startTunnelThenApp() {
  // 2) Tunnel FIRST — cloudflared tolerates the origin coming up afterward.
  const named = existsSync(CONFIG_PATH);

  // `protocol http2` (set in cloudflared.yml, or forced here for quick tunnels):
  // use HTTP/2 over TCP/443 instead of the default QUIC (UDP/7844). QUIC is
  // blocked on many networks and by most VPNs (Mullvad, Cloudflare WARP) — the
  // symptom is `failed to dial to edge with quic: timeout` + a 530 at the public
  // URL. TCP/443 is universally open. Override quick-tunnel proto via TUNNEL_PROTOCOL.
  const protocol = process.env.TUNNEL_PROTOCOL || "http2";

  const args = named
    ? ["tunnel", "--config", CONFIG_PATH, "run"]
    : ["tunnel", "--protocol", protocol, "--url", ORIGIN];
  const publicHost = named ? readHostname(CONFIG_PATH) : null;

  log(named
    ? `starting named cloudflared tunnel (${publicHost ?? "cloudflared.yml"}) → ${ORIGIN} …`
    : `starting cloudflared quick tunnel → ${ORIGIN} (protocol: ${protocol}) …`);
  const tunnel = spawnShell("cloudflared", args);
  let announced = false;

  const announce = (url, ephemeral) => {
    if (announced) return;
    announced = true;
    log("");
    log(`\x1b[1m\x1b[32mPUBLIC URL:  ${url}\x1b[0m`);
    log("Share this — it serves the LIVE app end-to-end (model calls run on THIS machine).");
    if (ephemeral) log("Quick tunnels are ephemeral: the URL changes each `npm run live`.");
    log("");
  };

  const scan = (buf) => {
    const s = buf.toString();
    process.stderr.write(s);
    if (named) {
      // Named tunnel: the URL is fixed; announce once the edge connection registers.
      if (/Registered tunnel connection/i.test(s) && publicHost) announce(`https://${publicHost}`, false);
    } else {
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) announce(m[0], true);
    }
  };
  tunnel.stdout?.on("data", scan);
  tunnel.stderr?.on("data", scan);
  tunnel.on("exit", (code) => {
    if (!shuttingDown) {
      log(`cloudflared exited (${code}). Is it installed + on PATH? (named tunnel needs cloudflared.yml + credentials)`);
      shutdown(code ?? 1);
    }
  });

  // 3) Then the app.
  log("starting the app (next start)…");
  const app = spawnShell("npm", ["run", "start"], { stdio: "inherit" });
  app.on("exit", (code) => shutdown(code ?? 0));
}

/** Pull the ingress hostname out of cloudflared.yml for the announce banner. */
function readHostname(configPath) {
  try {
    const m = readFileSync(configPath, "utf8").match(/hostname:\s*([^\s#]+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
