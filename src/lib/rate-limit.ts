// rate limiting for link creation, backed by upstash redis
// throttles each client ip with a sliding window so a single abuser cannot
// flood the database with links (spam / free-tier exhaustion protection)

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { z } from "zod";

// sliding window parameters: 10 created links per 10 minutes per ip
// a sliding window counts requests over a rolling period, so a client cannot
// burst right at a fixed-window boundary to double the effective limit
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW = "10 m";

// the message shown to a throttled user: friendly and deliberately vague —
// it never reveals the window size or remaining quota, so an abuser cannot
// tune their request rate to sit just under the limit
const RATE_LIMIT_MESSAGE =
  "Too many links created – please try again in a few minutes.";

// validates upstash credentials from the environment; env vars are external
// input and go through zod like everything else — values are referenced by
// variable name only and never logged or echoed back
const upstashEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url({
    protocol: /^https$/,
    error: "UPSTASH_REDIS_REST_URL must be a valid https url",
  }),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, { error: "UPSTASH_REDIS_REST_TOKEN must not be empty" }),
});

// the result the rest of the app consumes: a plain domain value instead of
// the raw upstash response — callers can surface `message` directly as a
// form error, and tests can fake this module without touching redis
export type RateLimitResult = { ok: true } | { ok: false; message: string };

// caches the limiter so credentials are validated and the client constructed
// only once per server process
let cachedLimiter: Ratelimit | undefined;

// builds the limiter on first use
// fails closed by design: missing or malformed credentials are a deployment
// mistake, and throwing loudly here surfaces it on the first request instead
// of silently running without any spam protection — the caller catches this,
// logs the details server-side and shows the user a generic error
function getLimiter(): Ratelimit {
  if (cachedLimiter) return cachedLimiter;

  const parsed = upstashEnvSchema.safeParse({
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  if (!parsed.success) {
    // names the variables but never their values, so nothing secret can leak
    // into server logs or error reporting
    throw new Error(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are missing or invalid – rate limiting cannot start"
    );
  }

  cachedLimiter = new Ratelimit({
    redis: new Redis({
      url: parsed.data.UPSTASH_REDIS_REST_URL,
      token: parsed.data.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
    // analytics would store extra per-request data in redis; the click counter
    // in postgres already covers the app's operational metrics
    analytics: false,
    // namespaces all limiter keys, so a redis database shared with anything
    // else never collides with these counters
    prefix: "jkl:ratelimit",
  });
  return cachedLimiter;
}

// extracts the client ip from request headers for use as the limiter key
// reads x-forwarded-for, which the hosting platform sets from the real
// connection; the leftmost entry is the original client when intermediate
// proxies append their own addresses
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim();
  // local development has no proxy and therefore no header — every request
  // then shares one bucket, which also makes the limit easy to test by hand
  return clientIp || "local";
}

// checks whether the identifier is within its creation quota
// note on redis outages: the upstash sdk applies a built-in timeout (5 s by
// default) and reports the request as allowed when redis does not answer in
// time — a transient outage degrades spam protection instead of taking the
// whole service down, a deliberate availability-over-protection trade-off
// (distinct from the missing-credentials case above, which fails closed)
export async function checkRateLimit(
  identifier: string
): Promise<RateLimitResult> {
  const { success } = await getLimiter().limit(identifier);
  if (success) {
    return { ok: true };
  }
  return { ok: false, message: RATE_LIMIT_MESSAGE };
}
