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
import { existsSync } from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || "3000";
const ORIGIN = `http://localhost:${PORT}`;
const isWin = process.platform === "win32";
const children = [];
let shuttingDown = false;

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
  log(`starting cloudflared quick tunnel → ${ORIGIN} …`);
  const tunnel = spawnShell("cloudflared", ["tunnel", "--url", ORIGIN]);
  let announced = false;

  const scan = (buf) => {
    const s = buf.toString();
    process.stderr.write(s);
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && !announced) {
      announced = true;
      const url = m[0];
      log("");
      log(`\x1b[1m\x1b[32mPUBLIC URL:  ${url}\x1b[0m`);
      log("Share this — it serves the live app (model calls run on THIS machine).");
      log("To point the Vercel deploy at this Ollama instead, set on Vercel:");
      log(`    OPENAI_COMPAT_URL = ${url.replace("//", "//")}/…  (a tunnel to :11434, not :3000)`);
      log("");
    }
  };
  tunnel.stdout?.on("data", scan);
  tunnel.stderr?.on("data", scan);
  tunnel.on("exit", (code) => {
    if (!shuttingDown) {
      log(`cloudflared exited (${code}). Is it installed + on PATH?`);
      shutdown(code ?? 1);
    }
  });

  // 3) Then the app.
  log("starting the app (next start)…");
  const app = spawnShell("npm", ["run", "start"], { stdio: "inherit" });
  app.on("exit", (code) => shutdown(code ?? 0));
}
