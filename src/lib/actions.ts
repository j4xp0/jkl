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
// (shortUrl exists only on success, error details only on error).
// submittedUrl echoes the user's raw input back on errors: react resets
// uncontrolled form fields to their defaultValue after an action, so without
// the echo a validation error would wipe what the user typed
export type ActionState =
  | { status: "idle" }
  | { status: "success"; shortUrl: string }
  | {
      status: "error";
      message?: string;
      fieldErrors?: { url?: string };
      submittedUrl?: string;
    };

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

// matches the rfc 3986 scheme grammar: ALPHA *( ALPHA / DIGIT / "+" / "-" /
// "." ) followed by ":" – any hit means the input already declares a scheme.
// the [a-zA-Z] classes cover both letter cases because schemes are
// case-insensitive per the rfc ("MAILTO:" declares a scheme as much as
// "mailto:"). the uppercase half is observable behavior, not just rfc
// hygiene – counterexample: "COM.EXAMPLE.APP://x" (reverse-domain schemes
// like this exist in the wild, and the scheme grammar allows dots). a
// lowercase-only pattern would miss that scheme, "COM.EXAMPLE.APP:" would
// then pass every host-candidate check below (dot, no whitespace, no @,
// lettered last label), and the prefixed "https://COM.EXAMPLE.APP://x"
// parses as host com.example.app with an empty port (the trailing ":"
// before the first slash) and path "//x" – a valid https url that would
// get shortened. this pattern leaves the input untouched instead, and the
// protocol whitelist rejects it. dot-free uppercase schemes without "//"
// ("HTTPS:example.com") die either way, but only because zod's url format
// check (as of zod 4.4.3) rejects any scheme not followed by "//" – an
// empirical wall of the current version, not a spec guarantee, so this
// pattern does not lean on it
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

// widens accepted input to bare domains: pasting "example.com/path" works
// like "https://example.com/path", while plain text such as "abc" keeps
// failing validation exactly as before
// a naive "no scheme -> prefix https://" would break that second promise:
// new URL("https://abc") parses fine, so "abc" would suddenly get shortened
// – hence the prefix only applies when the part before the path looks like
// a real host
function normalizeUrlInput(raw: string): string {
  // strips copy-paste whitespace before any shape checks run
  const trimmed = raw.trim();

  // input carrying a scheme – http:, ftp:, mailto:, javascript: – passes
  // through untouched so the protocol whitelist keeps the final say.
  // this branch also catches "example.com:8080/path": "example.com:"
  // matches the scheme grammar, and host:port vs scheme:path is genuinely
  // ambiguous without guessing, so such input is left alone (and rejected
  // by the whitelist) rather than second-guessed
  if (SCHEME_PATTERN.test(trimmed)) return trimmed;

  // the candidate host is everything before the first path, query or
  // fragment delimiter
  const hostCandidate = trimmed.split(/[/?#]/, 1)[0] ?? "";
  const labels = hostCandidate.split(".");
  const lastLabel = labels[labels.length - 1] ?? "";

  // all four checks must hold before the prefix is added:
  // - contains a dot: rejects single words ("abc") that would otherwise
  //   parse fine once prefixed
  // - no whitespace: hosts never contain spaces, pasted sentences do
  // - no @: prefixing "google.com@evil.com" would parse google.com as
  //   userinfo and evil.com as the real host – a link-cloaking classic
  //   that fails validation today and must keep failing
  // - last label has 2+ chars and a letter: real tlds look like this
  //   (punycode xn--… passes – it contains letters); bare ip addresses
  //   such as 192.168.1.1 stay unprefixed, their last label is a digit
  const looksLikeHost =
    hostCandidate.includes(".") &&
    !/\s/.test(hostCandidate) &&
    !hostCandidate.includes("@") &&
    lastLabel.length >= 2 &&
    /[a-zA-Z]/.test(lastLabel);

  return looksLikeHost ? `https://${trimmed}` : trimmed;
}

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
  // declared ahead of the try block so the catch-all path can echo it too;
  // every error variant carries the submitted text back so the form can
  // refill the input after react's automatic post-action reset. the echo is
  // inert data: it only ever feeds a defaultValue attribute (which react
  // escapes) – it never reaches a query, a log line or the database
  let submittedUrl: string | undefined;
  try {
    const rawUrl = formData.get("url");
    submittedUrl = typeof rawUrl === "string" ? rawUrl : undefined;

    // identifies the caller by ip and rejects over-quota clients up front
    const requestHeaders = await headers();
    const rateLimit = await checkRateLimit(getClientIp(requestHeaders));
    if (!rateLimit.ok) {
      return { status: "error", message: rateLimit.message, submittedUrl };
    }

    // validates the normalized value (bare domains get their https:// here)
    // while the echo above keeps the raw one – the user gets back exactly
    // what they typed, not what the server made of it. the schema still
    // enforces the length cap, the http/https-only protocol whitelist and
    // the own-host block on whatever comes out of normalization
    const validated = getUrlSchema().safeParse(
      typeof rawUrl === "string" ? normalizeUrlInput(rawUrl) : rawUrl
    );
    if (!validated.success) {
      // surfaces only the first issue – the form shows a single message
      // under the field, and the schema's messages are already user-friendly
      return {
        status: "error",
        fieldErrors: {
          url: validated.error.issues[0]?.message ?? "Please enter a valid URL.",
        },
        submittedUrl,
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
    return { status: "error", message: GENERIC_ERROR_MESSAGE, submittedUrl };
  }
}
