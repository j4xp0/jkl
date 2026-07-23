// validation schemas for every external input that enters the shortener
// security posture: whitelist over blacklist — only inputs that match the
// strict shape are accepted, everything else is rejected with a generic message

import { z } from "zod";

// hard cap on submitted url length; 2048 is a widely supported de-facto
// browser limit and keeps oversized payloads away from the parser and the db
export const MAX_URL_LENGTH = 2048;

// validates the app's own base url coming from the environment;
// env vars are external input too, so they go through zod like everything else
// (the protocol whitelist also applies here — the app itself must be http/https)
const appBaseUrlSchema = z.url({
  protocol: /^https?$/,
  error: "NEXT_PUBLIC_APP_URL must be a valid http(s) url",
});

// resolves the app's own hostname from the environment
// throws early (fail closed) when the variable is missing or malformed —
// without a known own-host the redirect-loop protection cannot work,
// so the app refuses to validate urls at all instead of guessing
// note: the error message names the variable but never echoes its value,
// so a malformed secret-adjacent env entry never leaks into logs
export function getAppHostname(): string {
  const parsed = appBaseUrlSchema.safeParse(process.env.NEXT_PUBLIC_APP_URL);
  if (!parsed.success) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is missing or invalid – set it to the app's base url"
    );
  }
  // new URL() lowercases the hostname and strips the port, which gives a
  // canonical value to compare against
  return new URL(parsed.data).hostname;
}

// builds the schema for user-submitted urls
// takes the app hostname as an argument so tests can pin it explicitly
// and production code can inject the value resolved from the environment
export function createUrlSchema(appHostname: string) {
  // normalizes once up front so the comparison below is case-insensitive
  // even when the caller passes an uppercase hostname
  const ownHostname = appHostname.toLowerCase();

  return (
    z
      // string checks run first on the raw form value: trims surrounding
      // whitespace (copy-paste artifacts) and rejects oversized input
      // before any url parsing happens
      .string({ error: "Please enter a URL." })
      .trim()
      .min(1, { error: "Please enter a URL." })
      .max(MAX_URL_LENGTH, {
        error: `URL is too long (max ${MAX_URL_LENGTH} characters).`,
      })
      // pipe() hands the cleaned string to the url format check;
      // z.url() parses with new URL(), so only syntactically real urls pass
      // the protocol whitelist blocks javascript:, data:, file:, ftp: and
      // every other scheme that could smuggle script execution through a
      // shortened link (a plain url check alone would let javascript: through)
      .pipe(
        z.url({
          protocol: /^https?$/,
          error: "Only http:// and https:// URLs can be shortened.",
        })
      )
      // blocks shortening the shortener itself: a short link pointing back at
      // this host would redirect to itself in a loop; comparing full hostnames
      // (not suffixes) keeps look-alike domains such as ourhost.evil.com valid,
      // and ignoring the port blocks the own domain on every port
      .refine(
        (value) => {
          // zod collects all issues, so this refinement still runs when the
          // url format check above has already failed; URL.canParse guards
          // the constructor from throwing on such non-url input, and
          // returning true avoids stacking a second, misleading error
          if (!URL.canParse(value)) return true;
          return new URL(value).hostname !== ownHostname;
        },
        { error: "This URL cannot be shortened." }
      )
  );
}

// caches the production schema so the environment is parsed only once per
// process; server actions grab the schema through this accessor
let cachedUrlSchema: ReturnType<typeof createUrlSchema> | undefined;
export function getUrlSchema() {
  cachedUrlSchema ??= createUrlSchema(getAppHostname());
  return cachedUrlSchema;
}
