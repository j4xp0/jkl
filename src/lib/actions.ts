"use server";

// server action that turns a submitted long url into a shortened link
// runs entirely on the server: the browser only ever posts form data and
// receives a plain state object back, so no secrets or db details cross over

import { headers } from "next/headers";
import { DrizzleQueryError } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { links } from "@/db/schema";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getAppBaseUrl, getUrlSchema } from "@/lib/validation";

// the form state consumed by useActionState: a discriminated union, so the
// ui can switch on `status` and typescript narrows the available fields
// (shortUrl exists only on success, error details only on error)
export type ActionState =
  | { status: "idle" }
  | { status: "success"; shortUrl: string }
  | { status: "error"; message?: string; fieldErrors?: { url?: string } };

// the user-facing fallback for any unexpected failure; deliberately generic –
// internals (db errors, stack traces) stay in server logs only
const GENERIC_ERROR_MESSAGE = "Something went wrong – please try again.";

// 7 random characters from nanoid's 64-symbol url-safe alphabet give ~4.4
// trillion combinations – collisions stay astronomically rare, and random
// slugs (csprng underneath) prevent anyone from enumerating existing links
const SLUG_LENGTH = 7;

// a collision is retried with a fresh slug; three attempts in a row failing
// means something is systemically wrong (not bad luck), so the action stops
// instead of hammering the database
const MAX_SLUG_ATTEMPTS = 3;

// narrows an unknown error to a postgres unique-constraint violation
// drizzle wraps driver errors in DrizzleQueryError and keeps the original
// as `cause`; the neon driver exposes the postgres sqlstate there, where
// "23505" means unique_violation – only that exact case is retried, every
// other error keeps propagating
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof DrizzleQueryError)) return false;
  const cause: unknown = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code: unknown }).code === "23505"
  );
}

// creates a short link for the submitted url
// order of checks is deliberate: the rate limiter runs first so throttled
// clients cost no validation or database work, then input validation, and
// only clean input ever reaches the database
export async function createLink(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    // identifies the caller by ip and rejects over-quota clients up front
    const requestHeaders = await headers();
    const rateLimit = await checkRateLimit(getClientIp(requestHeaders));
    if (!rateLimit.ok) {
      return { status: "error", message: rateLimit.message };
    }

    // validates the raw form value; the schema enforces trim, length cap,
    // http/https-only protocol and the own-host block
    const validated = getUrlSchema().safeParse(formData.get("url"));
    if (!validated.success) {
      // surfaces only the first issue – the form shows a single message
      // under the field, and the schema's messages are already user-friendly
      return {
        status: "error",
        fieldErrors: {
          url: validated.error.issues[0]?.message ?? "Please enter a valid URL.",
        },
      };
    }

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = nanoid(SLUG_LENGTH);
      try {
        await db.insert(links).values({ slug, url: validated.data });
        // the base url comes from the validated environment, so the short
        // link is always absolute and points at this deployment
        return { status: "success", shortUrl: `${getAppBaseUrl()}/${slug}` };
      } catch (error) {
        // a taken slug is the one recoverable failure: loops again with a
        // freshly generated slug; anything else aborts to the outer handler
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }

    // reaching this point means every attempt collided – treated as an
    // internal fault and reported like any other unexpected error
    throw new Error("slug generation exhausted all retry attempts");
  } catch (error) {
    // full details go to the server log for debugging; the user gets only
    // the generic message – error internals could reveal schema or infra
    console.error("createLink failed:", error);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
