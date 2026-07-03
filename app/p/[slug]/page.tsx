import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdvertorial } from "@/lib/advertorialStore";

/**
 * The LIVE advertorial page (build plan §4: "the judge clicks these").
 * Serves a stored advertorial at /p/[slug] through the store's fallback
 * chain (memory → data dir → bundled seeds — see lib/advertorialStore.ts).
 *
 * The html is OUR fixed template's output with every model string escaped at
 * render time (agents/advertorial.ts), so dangerouslySetInnerHTML here is
 * injecting our own trusted markup, not model- or user-authored HTML.
 *
 * force-dynamic: the store reads the filesystem per-request; freshly
 * generated advertorials must appear without a rebuild.
 */
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const record = await getAdvertorial(slug);
  if (!record) return { title: "Not found" };
  return {
    title: `${record.content.headline} — Sponsored`,
    description: record.content.deck,
  };
}

export default async function AdvertorialPage({ params }: Props) {
  const { slug } = await params;
  const record = await getAdvertorial(slug);
  if (!record) notFound();
  return <div dangerouslySetInnerHTML={{ __html: record.advertorial.html }} />;
}
