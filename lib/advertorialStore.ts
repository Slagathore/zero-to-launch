import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Advertorial } from "@/agents/types";
import type { AdvertorialContent } from "@/agents/advertorial";

/**
 * Advertorial persistence (build plan §3: "stateless per-run, no DB" — this
 * is deliberately just files + memory, not a database). Read path is a
 * fallback chain:
 *
 *   1. in-memory cache        — same-process hits (the common demo path)
 *   2. data dir               — ./data/advertorials (gitignored), durable
 *                               across local dev restarts; on read-only
 *                               filesystems (Vercel) writes fall back to tmp
 *   3. bundled seed dir       — ./examples/advertorials (COMMITTED): seed
 *                               advertorials ship inside the deploy bundle,
 *                               so /p/[slug] serves them on the public Vercel
 *                               URL with no tunnel and no writable disk. This
 *                               is what makes "the judge clicks a real page
 *                               on a live URL" true from S3 onward.
 *
 * Serverless caveat (documented, accepted): freshly-generated advertorials
 * on Vercel live in that lambda's /tmp — a later GET may miss. Fine for now:
 * live generation is local until the S5 tunnel, and seeds cover the public
 * demo path. S5 revisits (more seeds and/or edge-KV as post-submit polish).
 */

export interface AdvertorialRecord {
  advertorial: Advertorial;
  content: AdvertorialContent;
  offer: { product: string; vertical: string; url: string };
  createdAt: string; // ISO
}

/** Slugs are strictly [a-z0-9-] — blocks path traversal at the API boundary. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug);
}

const memory = new Map<string, AdvertorialRecord>();

function primaryDir(): string {
  return process.env.ADVERTORIAL_DIR || path.join(process.cwd(), "data", "advertorials");
}
function tmpDir(): string {
  return path.join(os.tmpdir(), "zero-to-launch-advertorials");
}
function seedDir(): string {
  return process.env.ADVERTORIAL_SEED_DIR || path.join(process.cwd(), "examples", "advertorials");
}

async function writeTo(dir: string, slug: string, record: AdvertorialRecord): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${slug}.json`), JSON.stringify(record, null, 2), "utf8");
}

async function readFrom(dir: string, slug: string): Promise<AdvertorialRecord | null> {
  try {
    const raw = await fs.readFile(path.join(dir, `${slug}.json`), "utf8");
    return JSON.parse(raw) as AdvertorialRecord;
  } catch {
    return null;
  }
}

/** Persist a record: memory always; disk best-effort (data dir, then tmp). */
export async function saveAdvertorial(record: AdvertorialRecord): Promise<void> {
  const slug = record.advertorial.slug;
  if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
  memory.set(slug, record);
  try {
    await writeTo(primaryDir(), slug, record);
  } catch {
    // Read-only filesystem (serverless) — fall back to tmp; memory already has it.
    try {
      await writeTo(tmpDir(), slug, record);
    } catch {
      /* memory-only is still a working demo within this process */
    }
  }
}

/** Fetch a record through the fallback chain. Returns null when absent everywhere. */
export async function getAdvertorial(slug: string): Promise<AdvertorialRecord | null> {
  if (!isValidSlug(slug)) return null;
  const hit = memory.get(slug);
  if (hit) return hit;
  const fromDisk =
    (await readFrom(primaryDir(), slug)) ??
    (await readFrom(tmpDir(), slug)) ??
    (await readFrom(seedDir(), slug));
  if (fromDisk) memory.set(slug, fromDisk);
  return fromDisk;
}

/** All known slugs (memory + data dir + seeds), newest-file first, deduped. */
export async function listAdvertorials(): Promise<string[]> {
  const slugs = new Set<string>(memory.keys());
  for (const dir of [primaryDir(), tmpDir(), seedDir()]) {
    try {
      for (const f of await fs.readdir(dir)) {
        if (f.endsWith(".json")) slugs.add(f.slice(0, -5));
      }
    } catch {
      /* dir may not exist — fine */
    }
  }
  return [...slugs];
}
