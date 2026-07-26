// tests for the url validation schema – the security core of the shortener
// every rejection case here maps to a real attack vector: script-scheme
// injection, redirect loops on the own host, and oversized payloads

import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
// imports through the "@/*" alias on purpose: it keeps test imports identical
// to app code and proves the alias resolution works in the test runner
import {
  createUrlSchema,
  getAppBaseUrl,
  getAppHostname,
  MAX_URL_LENGTH,
  slugSchema,
} from "@/lib/validation";

// pins the app hostname explicitly so tests do not depend on the environment
const schema = createUrlSchema("localhost");

// builds a syntactically valid https url of exactly the requested length
// by padding the path; keeps boundary tests readable
function urlOfLength(length: number): string {
  const base = "https://example.com/";
  return base + "a".repeat(length - base.length);
}

describe("url schema – accepted input", () => {
  it("accepts a plain http url", () => {
    const result = schema.safeParse("http://example.com");
    expect(result.success).toBe(true);
  });

  it("accepts a plain https url", () => {
    const result = schema.safeParse("https://example.com/path?query=1#hash");
    expect(result.success).toBe(true);
  });

  it("accepts an uppercase scheme (new URL() normalizes protocol case)", () => {
    const result = schema.safeParse("HTTPS://EXAMPLE.COM");
    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace and returns the cleaned value", () => {
    const result = schema.safeParse("  https://example.com  ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("https://example.com");
    }
  });

  it("accepts a url of exactly the maximum length", () => {
    const result = schema.safeParse(urlOfLength(MAX_URL_LENGTH));
    expect(result.success).toBe(true);
  });

  it("accepts a foreign host that merely contains the own hostname", () => {
    // documents that the own-host block compares full hostnames, not suffixes:
    // localhost.evil.com is an attacker domain, not this app, and must pass
    // url validation (only the exact own hostname is refused)
    const result = schema.safeParse("https://localhost.evil.com/phish");
    expect(result.success).toBe(true);
  });
});

describe("url schema – protocol whitelist", () => {
  it("rejects a javascript: url (xss via link scheme)", () => {
    const result = schema.safeParse("javascript:alert(1)");
    expect(result.success).toBe(false);
  });

  it("rejects a data: url (script or html smuggled inline)", () => {
    const result = schema.safeParse(
      "data:text/html,<script>alert(1)</script>"
    );
    expect(result.success).toBe(false);
  });

  it("rejects an uppercase javascript: scheme (case tricks do not bypass)", () => {
    const result = schema.safeParse("JaVaScRiPt:alert(1)");
    expect(result.success).toBe(false);
  });

  it("rejects ftp: even though it is a syntactically valid url", () => {
    const result = schema.safeParse("ftp://example.com/file.txt");
    expect(result.success).toBe(false);
  });

  it("rejects file: urls (local file system access)", () => {
    const result = schema.safeParse("file:///etc/passwd");
    expect(result.success).toBe(false);
  });
});

describe("url schema – own host block (redirect loop protection)", () => {
  it("rejects the app's own host", () => {
    const result = schema.safeParse("http://localhost:3000/abc123");
    expect(result.success).toBe(false);
  });

  it("rejects the own host on a different port", () => {
    // the block ignores ports on purpose: any port on the own hostname
    // still lands on the same machine and can loop back into the app
    const result = schema.safeParse("http://localhost:5000/other");
    expect(result.success).toBe(false);
  });

  it("rejects the own host written in uppercase", () => {
    const result = schema.safeParse("http://LOCALHOST:3000/abc123");
    expect(result.success).toBe(false);
  });
});

describe("url schema – shape and size limits", () => {
  it("rejects an empty string", () => {
    const result = schema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only input (trim runs before the emptiness check)", () => {
    const result = schema.safeParse("   ");
    expect(result.success).toBe(false);
  });

  it("rejects plain text that is not a url", () => {
    const result = schema.safeParse("not a url at all");
    expect(result.success).toBe(false);
  });

  it("rejects a url one character over the maximum length", () => {
    const result = schema.safeParse(urlOfLength(MAX_URL_LENGTH + 1));
    expect(result.success).toBe(false);
  });

  it("rejects non-string input (forms can be posted programmatically)", () => {
    const result = schema.safeParse(12345);
    expect(result.success).toBe(false);
  });
});

describe("slug schema – path pre-validation", () => {
  it("accepts a typical generated slug", () => {
    expect(slugSchema.safeParse("x7Kp2_a").success).toBe(true);
  });

  it("rejects slugs outside the 4–16 length window", () => {
    expect(slugSchema.safeParse("abc").success).toBe(false);
    expect(slugSchema.safeParse("a".repeat(17)).success).toBe(false);
  });

  it("rejects characters outside the url-safe alphabet", () => {
    expect(slugSchema.safeParse("abc$12").success).toBe(false);
    expect(slugSchema.safeParse("../abcd").success).toBe(false);
  });
});

describe("getAppHostname – environment parsing", () => {
  afterEach(() => {
    // restores the real environment after each stubbed case
    vi.unstubAllEnvs();
  });

  it("returns the lowercased hostname without the port", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://LOCALHOST:3000");
    expect(getAppHostname()).toBe("localhost");
  });

  it("throws when the variable is missing (fail closed)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(() => getAppHostname()).toThrow();
  });

  it("throws when the variable is not an http(s) url", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "javascript:alert(1)");
    expect(() => getAppHostname()).toThrow();
  });

  it("normalizes the base url to a clean origin", () => {
    // a trailing slash or stray path in the env value must not leak into
    // generated short links (no double slashes)
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000/");
    expect(getAppBaseUrl()).toBe("http://localhost:3000");
  });
});
