import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  saveAdvertorial, getAdvertorial, listAdvertorials, isValidSlug, type AdvertorialRecord,
} from "../advertorialStore";

function record(slug: string): AdvertorialRecord {
  return {
    advertorial: { angleId: "angle-1", slug, html: "<div>hi</div>", ftcDisclosure: "PAID ADVERTISEMENT" },
    content: {
      headline: "H", deck: "D", authorLabel: "A",
      sections: [{ type: "paragraph", text: "p" }], ctaText: "Go", disclaimerNotes: [],
    },
    offer: { product: "P", vertical: "v", url: "" },
    createdAt: "2026-07-03T12:00:00.000Z",
  };
}

let dataDir: string;
let seedsDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "adv-data-"));
  seedsDir = await fs.mkdtemp(path.join(os.tmpdir(), "adv-seed-"));
  process.env.ADVERTORIAL_DIR = dataDir;
  process.env.ADVERTORIAL_SEED_DIR = seedsDir;
});

afterEach(async () => {
  delete process.env.ADVERTORIAL_DIR;
  delete process.env.ADVERTORIAL_SEED_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(seedsDir, { recursive: true, force: true });
});

describe("isValidSlug", () => {
  it("accepts lowercase alnum + hyphens and rejects traversal/uppercase/specials", () => {
    expect(isValidSlug("ketoslim-gummies-curiosity-ab12")).toBe(true);
    expect(isValidSlug("../../etc/passwd")).toBe(false);
    expect(isValidSlug("UPPER")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-leading-hyphen")).toBe(false);
  });
});

describe("save/get round-trip", () => {
  it("persists to the data dir and reads back", async () => {
    await saveAdvertorial(record("round-trip-1"));
    // Confirm it actually hit the filesystem, not just memory.
    const onDisk = JSON.parse(await fs.readFile(path.join(dataDir, "round-trip-1.json"), "utf8"));
    expect(onDisk.advertorial.slug).toBe("round-trip-1");
    const back = await getAdvertorial("round-trip-1");
    expect(back?.advertorial.html).toBe("<div>hi</div>");
  });

  it("rejects an invalid slug at save time", async () => {
    await expect(saveAdvertorial(record("../evil"))).rejects.toThrow(/Invalid slug/);
  });

  it("returns null for a missing or malicious slug", async () => {
    expect(await getAdvertorial("nope-never-existed")).toBeNull();
    expect(await getAdvertorial("../../etc/passwd")).toBeNull();
  });
});

describe("bundled-seed fallback", () => {
  it("serves a record found only in the seed dir (the deployed-URL path)", async () => {
    const seeded = record("seeded-advertorial-x1");
    await fs.writeFile(path.join(seedsDir, "seeded-advertorial-x1.json"), JSON.stringify(seeded), "utf8");
    const got = await getAdvertorial("seeded-advertorial-x1");
    expect(got?.advertorial.slug).toBe("seeded-advertorial-x1");
  });
});

describe("listAdvertorials", () => {
  it("unions data-dir and seed-dir slugs", async () => {
    await saveAdvertorial(record("list-a"));
    await fs.writeFile(path.join(seedsDir, "list-b.json"), JSON.stringify(record("list-b")), "utf8");
    const slugs = await listAdvertorials();
    expect(slugs).toContain("list-a");
    expect(slugs).toContain("list-b");
  });
});
