// tests for the redirect route handler
// the database module is mocked at its seam, so these tests exercise the
// handler's gatekeeping and response shaping: the regex gate in front of the
// db, 404 for unknown slugs, the 307 contract and error containment

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/[slug]/route";

// vi.hoisted lifts the chain mocks above the hoisted vi.mock factory below;
// the handler only ever calls db.update(links).set(...).where(...).returning(...),
// so this four-step chain is the entire mocked surface
const { updateMock, setMock, returningMock } = vi.hoisted(() => {
  const returningMock = vi.fn();
  const whereMock = vi.fn(() => ({ returning: returningMock }));
  // the explicit generic gives the mock a one-argument signature, so the
  // recorded calls stay indexable – tests below inspect the update payload
  const setMock = vi.fn<(values: Record<string, unknown>) => unknown>(() => ({
    where: whereMock,
  }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  return { updateMock, setMock, returningMock };
});

vi.mock("@/db", () => ({
  db: { update: updateMock },
}));

// invokes the handler the way next.js does: params arrive as a promise
function callRoute(slug: string): Promise<Response> {
  const request = new Request(`http://localhost:3000/${slug}`);
  return GET(request, { params: Promise.resolve({ slug }) });
}

describe("GET /[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // keeps expected error-path logging out of the test output while still
    // allowing assertions that logging happened
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // each entry represents a different attack or garbage shape: too short,
  // illegal characters, over the length cap, traversal-style input
  it.each([
    ["ab", "too short"],
    ["abc$12", "character outside the url-safe alphabet"],
    ["a".repeat(17), "over the length cap"],
    ["..%2Fetc", "traversal-style probe"],
  ])("returns 404 for slug %j (%s) without touching the db", async (slug) => {
    const response = await callRoute(slug);

    expect(response.status).toBe(404);
    // the whole point of the regex gate: invalid shapes cost zero queries
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the slug has a valid shape but no row exists", async () => {
    // an empty returning set is how the update signals "no such slug"
    returningMock.mockResolvedValueOnce([]);

    const response = await callRoute("zzzz9999");

    expect(response.status).toBe(404);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("redirects an existing slug with 307 and counts the click", async () => {
    returningMock.mockResolvedValueOnce([{ url: "https://example.com/target" }]);

    const response = await callRoute("x7Kp2ab");

    // 307 keeps every click going through the server (kill-switch + honest
    // counter); the location header carries the stored destination untouched
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/target");
    // the same single query must also bump the operational metrics
    expect(setMock).toHaveBeenCalledTimes(1);
    const updatePayload = setMock.mock.calls[0]?.[0];
    expect(updatePayload).toHaveProperty("clicks");
    expect(updatePayload).toHaveProperty("lastClickedAt");
  });

  it("returns 500 and logs when the database fails", async () => {
    returningMock.mockRejectedValueOnce(new Error("connection refused"));

    const response = await callRoute("x7Kp2ab");

    expect(response.status).toBe(500);
    // details of the failure are logged server-side, never sent to the client
    expect(console.error).toHaveBeenCalled();
  });
});
