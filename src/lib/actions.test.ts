// tests for the createLink server action
// external boundaries (request headers, rate limiter, database) are mocked at
// their module seams, so these tests exercise the action's decision logic –
// ordering of checks, retry behavior, error shaping – without any network

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { createLink, type ActionState } from "@/lib/actions";
import { checkRateLimit } from "@/lib/rate-limit";

// vi.hoisted lifts this declaration above the hoisted vi.mock factories,
// so the db mock below can close over it
const { valuesMock } = vi.hoisted(() => ({ valuesMock: vi.fn() }));

// fakes the request context: a stable client ip is all the action reads
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));

// fakes the rate limiter at its domain boundary – tests flip the result
// per scenario instead of talking to redis
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true as const })),
  getClientIp: vi.fn(() => "203.0.113.7"),
}));

// fakes the database module: the action only ever calls
// db.insert(links).values(row), so a two-step chain is the whole surface
vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(() => ({ values: valuesMock })),
  },
}));

// builds the same error shape the real stack throws on a taken slug:
// drizzle's wrapper with the postgres unique_violation sqlstate as cause –
// using the real DrizzleQueryError class means these tests break loudly
// if a library update ever changes the error contract
function uniqueViolationError(): DrizzleQueryError {
  const cause = Object.assign(
    new Error('duplicate key value violates unique constraint "links_slug_unique"'),
    { code: "23505" }
  );
  return new DrizzleQueryError("insert into links ...", [], cause);
}

// wraps a url in form data the way the browser submits it
function formDataWith(url: string): FormData {
  const formData = new FormData();
  formData.set("url", url);
  return formData;
}

const initialState: ActionState = { status: "idle" };

describe("createLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // the action builds the short link from the app's base url; tests pin it
    // to a known value so assertions are deterministic
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    // keeps expected error-path logging out of the test output while still
    // allowing assertions that logging happened
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns a full short url on success", async () => {
    valuesMock.mockResolvedValueOnce(undefined);

    const result = await createLink(initialState, formDataWith("https://example.com"));

    expect(result.status).toBe("success");
    if (result.status === "success") {
      // absolute url: validated base + one 7-char url-safe slug segment
      expect(result.shortUrl).toMatch(
        /^http:\/\/localhost:3000\/[A-Za-z0-9_-]{7}$/
      );
    }
    expect(valuesMock).toHaveBeenCalledTimes(1);
    // the stored row carries the validated url untouched
    expect(valuesMock.mock.calls[0]?.[0]).toMatchObject({
      url: "https://example.com",
    });
  });

  it("rejects a throttled client before validating or touching the db", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      ok: false,
      message: "Too many links created – please try again in a few minutes.",
    });

    // the url is deliberately invalid: a rate-limited request must be
    // rejected with the limiter's message, proving the limiter runs first
    const result = await createLink(initialState, formDataWith("javascript:alert(1)"));

    expect(result).toEqual({
      status: "error",
      message: "Too many links created – please try again in a few minutes.",
      // even a throttled submission echoes the input back, so the form can
      // restore what the user typed
      submittedUrl: "javascript:alert(1)",
    });
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("returns a field error for an invalid url and never touches the db", async () => {
    const result = await createLink(initialState, formDataWith("javascript:alert(1)"));

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.url).toBeTruthy();
      // the message stays user-facing: no zod internals, no technical jargon
      expect(result.message).toBeUndefined();
      // the rejected input comes back verbatim as the echo for the form
      expect(result.submittedUrl).toBe("javascript:alert(1)");
    }
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("retries with a fresh slug after a collision and then succeeds", async () => {
    valuesMock
      .mockRejectedValueOnce(uniqueViolationError())
      .mockResolvedValueOnce(undefined);

    const result = await createLink(initialState, formDataWith("https://example.com"));

    expect(result.status).toBe("success");
    expect(valuesMock).toHaveBeenCalledTimes(2);
    // the retry must generate a new slug, not re-insert the colliding one
    const firstSlug = valuesMock.mock.calls[0]?.[0]?.slug;
    const secondSlug = valuesMock.mock.calls[1]?.[0]?.slug;
    expect(firstSlug).not.toBe(secondSlug);
  });

  it("gives up after three collisions with a generic error", async () => {
    valuesMock
      .mockRejectedValueOnce(uniqueViolationError())
      .mockRejectedValueOnce(uniqueViolationError())
      .mockRejectedValueOnce(uniqueViolationError());

    const result = await createLink(initialState, formDataWith("https://example.com"));

    expect(result).toEqual({
      status: "error",
      message: "Something went wrong – please try again.",
      submittedUrl: "https://example.com",
    });
    expect(valuesMock).toHaveBeenCalledTimes(3);
    // details of the failure are logged server-side, never shown to the user
    expect(console.error).toHaveBeenCalled();
  });

  it("does not retry on a non-collision db error", async () => {
    valuesMock.mockRejectedValueOnce(new Error("connection refused"));

    const result = await createLink(initialState, formDataWith("https://example.com"));

    expect(result).toEqual({
      status: "error",
      message: "Something went wrong – please try again.",
      submittedUrl: "https://example.com",
    });
    // retrying only makes sense for slug collisions; infrastructure errors
    // fail fast instead of tripling the load on a struggling database
    expect(valuesMock).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  // covers the scheme-less input normalization: bare domains gain https://
  // before validation, everything else must behave exactly as before –
  // these tests observe only createLink's contract (state out, row in),
  // never the helper's internals
  describe("url normalization", () => {
    it("prefixes a bare domain with a path and stores the url verbatim", async () => {
      valuesMock.mockResolvedValueOnce(undefined);

      const result = await createLink(
        initialState,
        formDataWith(
          "cdaction.pl/teksty/gothic-remake-porady-na-start-5-rzeczy-ktore-chcialbym-wiedziec-przed-zagraniem/"
        )
      );

      expect(result.status).toBe("success");
      // exact match on purpose – this doubles as a canary: if the validator
      // ever started rewriting urls (trailing slash, case folding), the
      // character-for-character comparison here would break loudly
      expect(valuesMock.mock.calls[0]?.[0]).toMatchObject({
        url: "https://cdaction.pl/teksty/gothic-remake-porady-na-start-5-rzeczy-ktore-chcialbym-wiedziec-przed-zagraniem/",
      });
    });

    it("prefixes a bare domain without a path", async () => {
      valuesMock.mockResolvedValueOnce(undefined);

      const result = await createLink(initialState, formDataWith("example.com"));

      expect(result.status).toBe("success");
      // no trailing slash appears: the prefix is plain string concatenation
      // and the validator passes the value through unrewritten
      expect(valuesMock.mock.calls[0]?.[0]).toMatchObject({
        url: "https://example.com",
      });
    });

    it("keeps an explicit http scheme untouched", async () => {
      valuesMock.mockResolvedValueOnce(undefined);

      const result = await createLink(
        initialState,
        formDataWith("http://example.com")
      );

      expect(result.status).toBe("success");
      // normalization never upgrades declared schemes – http stays http
      expect(valuesMock.mock.calls[0]?.[0]).toMatchObject({
        url: "http://example.com",
      });
    });

    it("still rejects ftp urls", async () => {
      const result = await createLink(
        initialState,
        formDataWith("ftp://example.com")
      );

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.fieldErrors?.url).toBeTruthy();
      }
      expect(valuesMock).not.toHaveBeenCalled();
    });

    it("still rejects javascript: input without prefixing it", async () => {
      const result = await createLink(
        initialState,
        formDataWith("javascript:alert(1)")
      );

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.fieldErrors?.url).toBeTruthy();
        // the raw echo proves the scheme-carrying input was never touched
        expect(result.submittedUrl).toBe("javascript:alert(1)");
      }
      expect(valuesMock).not.toHaveBeenCalled();
    });

    it("rejects MAILTO:user@example.com like any input with @ before the path", async () => {
      // second coverage of the @ ban, not of scheme case handling: even
      // with a lowercase-only scheme pattern this input would be caught by
      // the @ ban, so the two regex variants are indistinguishable here –
      // the uppercase class in the scheme pattern is behaviorally
      // unobservable while the @ ban holds (see the pattern's comment)
      const result = await createLink(
        initialState,
        formDataWith("MAILTO:user@example.com")
      );

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.fieldErrors?.url).toBeTruthy();
        expect(result.submittedUrl).toBe("MAILTO:user@example.com");
      }
      expect(valuesMock).not.toHaveBeenCalled();
    });

    it("rejects google.com@evil.com without prefixing it", async () => {
      // prefixing would parse google.com as userinfo and evil.com as the
      // real host – the classic link-cloaking shape must keep failing
      const result = await createLink(
        initialState,
        formDataWith("google.com@evil.com")
      );

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.fieldErrors?.url).toBeTruthy();
        expect(result.submittedUrl).toBe("google.com@evil.com");
      }
      expect(valuesMock).not.toHaveBeenCalled();
    });

    it("rejects example.com:8080/path (documented decision)", async () => {
      // deliberate: "example.com:" matches the rfc 3986 scheme grammar, and
      // telling host:port apart from scheme:path is impossible without
      // guessing – such input goes to validation untouched and fails the
      // protocol whitelist; explicit-scheme urls with ports keep working
      const result = await createLink(
        initialState,
        formDataWith("example.com:8080/path")
      );

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.fieldErrors?.url).toBeTruthy();
      }
      expect(valuesMock).not.toHaveBeenCalled();
    });

    it("still rejects plain text and echoes it verbatim", async () => {
      const result = await createLink(initialState, formDataWith("abc"));

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.fieldErrors?.url).toBeTruthy();
        // the echo carries the raw input, not the normalized value
        expect(result.submittedUrl).toBe("abc");
      }
      expect(valuesMock).not.toHaveBeenCalled();
    });

    it("trims surrounding whitespace before deciding on the prefix", async () => {
      valuesMock.mockResolvedValueOnce(undefined);

      const result = await createLink(
        initialState,
        formDataWith("   example.com   ")
      );

      expect(result.status).toBe("success");
      expect(valuesMock.mock.calls[0]?.[0]).toMatchObject({
        url: "https://example.com",
      });
    });
  });
});
