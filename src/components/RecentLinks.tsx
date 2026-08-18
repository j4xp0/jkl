"use client";

// session-scoped list of recently created short links, rendered under the
// shortener form
// the data lives only in this tab's memory by design: the service has no
// accounts, so the server keeps no association between links and a person –
// a refresh clears the list, and that is a privacy property, not a defect
// runs as a client component because the list is fed by form state that
// only exists in the browser

// one row of the list: a created row is a finished short link, a pending row
// mirrors an in-flight submit (it confirms into a created row on success and
// disappears on failure). modeled as a discriminated union so the ui can
// switch on `kind` and typescript narrows the fields of each variant
export type RecentLinkEntry =
  | { kind: "created"; shortUrl: string; targetUrl: string }
  | { kind: "pending"; id: string; targetUrl: string };

// resolves the hostname a browser would actually navigate to, so the row can
// show it explicitly as its primary label. this is a security requirement of
// the display layer: an address like https://google.com@evil.com really
// leads to evil.com (google.com is just userinfo), and an address string
// truncated from the right would promote that decoy to the visible start –
// turning missing information into false information. a url parser never
// confuses userinfo with the host, so the parsed hostname is shown and the
// raw address is demoted to secondary, freely truncatable text
function getDisplayHost(raw: string): string | null {
  const trimmed = raw.trim();
  // input that already carries a scheme is parsed as-is. new URL does not
  // throw for authority-less schemes such as javascript: or mailto: – it
  // returns an object with an empty hostname instead, so empty counts as
  // "no host" exactly like a parse failure
  try {
    const { hostname } = new URL(trimmed);
    return hostname === "" ? null : hostname;
  } catch {
    // scheme-less input gets an unconditional https:// prefix before a
    // second parse. this is deliberately laxer than the server's input
    // normalization, which prefixes only host-shaped input – here a plain
    // word like "abc" does resolve to host "abc" and shows as one while its
    // submit is in flight (the server then rejects it and the row vanishes).
    // the display layer only labels what the user submitted; server-side
    // validation stays the sole source of truth for what actually gets
    // stored
    try {
      const { hostname } = new URL(`https://${trimmed}`);
      return hostname === "" ? null : hostname;
    } catch {
      return null;
    }
  }
}

export function RecentLinks({ entries }: { entries: RecentLinkEntry[] }) {
  // renders nothing until the first link exists: the page has a single call
  // to action and an empty "no links yet" box would only add noise – the
  // section appears together with the first shortened link
  if (entries.length === 0) return null;

  return (
    <div className="mt-6">
      {/* visible caption for sighted users; the list itself carries an
          aria-label so screen reader list navigation announces what the
          list holds without depending on reading order */}
      <p className="text-xs text-text-dim">Created this session</p>
      <ul
        aria-label="Links created this session"
        className="mt-2 flex flex-col gap-3"
      >
        {entries.map((entry) => {
          const host = getDisplayHost(entry.targetUrl);
          return (
            // created rows key by their short url (unique per link), the
            // pending row by the random id minted when the submit started.
            // aria-busy marks the pending row as loading for assistive tech
            // – no live region here, the result card's mount focus already
            // announces the outcome on its own channel
            <li
              key={entry.kind === "created" ? entry.shortUrl : entry.id}
              aria-busy={entry.kind === "pending" ? true : undefined}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              {/* min-w-0 lets the destination column shrink and truncate
                  instead of pushing the short link out of the row */}
              <span className="min-w-0 flex-1">
                {/* hostname as the primary label – see getDisplayHost. when
                    no host can be resolved the slot shows a neutral
                    placeholder; the raw text never stands in for a host */}
                <span
                  className={
                    host === null
                      ? "block text-sm text-text-dim"
                      : "block text-sm font-medium"
                  }
                >
                  {host ?? "unknown host"}
                </span>
                {/* the raw submitted address, secondary and truncated from
                    the right: with the real host already shown above, the
                    cut tail cannot mislead anyone about the destination */}
                <span className="block truncate text-xs text-text-dim">
                  {entry.targetUrl}
                </span>
              </span>
              {entry.kind === "created" ? (
                // a real link, consistent with the result card: noopener
                // cuts the opened page's access to window.opener (tabnabbing
                // protection), noreferrer keeps the referer header out of
                // the request; break-all wraps long urls on narrow screens
                <a
                  href={entry.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm break-all text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {entry.shortUrl}
                </a>
              ) : (
                // placeholder in the short-link slot while the submit runs –
                // not a link, because there is no address to open yet
                <span className="font-mono text-sm text-text-dim">
                  Shortening…
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
