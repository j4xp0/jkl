// redirect endpoint for short links: GET /{slug} sends the visitor to the
// stored destination url and counts the click on the way through

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { links } from "@/db/schema";
import { slugSchema } from "@/lib/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  // route params resolve asynchronously and are external input, so the slug
  // gets awaited and validated before anything else happens
  const { slug } = await context.params;

  // cheap regex gate in front of the database: malformed ids and scanner
  // noise turn into an immediate 404 without ever costing a query, and the
  // strict url-safe alphabet leaves no room for crafted path values
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    return new Response("Not found", { status: 404 });
  }

  let destination: string | undefined;
  try {
    // one atomic round trip does all the database work: bumps the counter,
    // stamps the click time and returns the destination url – a separate
    // select-then-update pair would race under concurrent clicks and double
    // the latency on the app's hottest path
    const [row] = await db
      .update(links)
      .set({
        // computed inside sql so concurrent clicks never lose an increment
        clicks: sql`${links.clicks} + 1`,
        // database clock, consistent with the created_at default
        lastClickedAt: sql`now()`,
      })
      .where(eq(links.slug, parsedSlug.data))
      .returning({ url: links.url });
    // an empty result set doubles as the "slug does not exist" signal –
    // no extra existence check needed
    destination = row?.url;
  } catch (error) {
    // db details stay in the server log; the visitor gets a bare status
    console.error("redirect lookup failed:", error);
    return new Response("Something went wrong", { status: 500 });
  }

  if (!destination) {
    return new Response("Not found", { status: 404 });
  }

  // 307 keeps the redirect temporary: the browser re-asks the server on
  // every click, so a removed link dies immediately (kill-switch for abuse)
  // and the click counter stays truthful – a cached 301/308 would bypass
  // both; the explicit status also documents that this is a deliberate choice
  return NextResponse.redirect(destination, 307);
}
