import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSeededRun } from "../seededRun";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "seed-"));
});
afterEach(async () => {
  delete process.env.SEEDED_RUN_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadSeededRun", () => {
  it("returns null when the seed file is absent", async () => {
    process.env.SEEDED_RUN_PATH = path.join(dir, "nope.json");
    expect(await loadSeededRun()).toBeNull();
  });

  it("parses a seed file when present", async () => {
    const p = path.join(dir, "seed.json");
    await fs.writeFile(p, JSON.stringify({ advertorialSlug: "x", advertorialUrl: "/p/x" }), "utf8");
    process.env.SEEDED_RUN_PATH = p;
    const seed = await loadSeededRun();
    expect(seed?.advertorialUrl).toBe("/p/x");
  });

  it("returns null (not throw) on malformed JSON", async () => {
    const p = path.join(dir, "bad.json");
    await fs.writeFile(p, "{ not json", "utf8");
    process.env.SEEDED_RUN_PATH = p;
    expect(await loadSeededRun()).toBeNull();
  });
});
