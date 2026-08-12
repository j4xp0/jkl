"use client";

// presents a freshly created short link: a real anchor for opening it plus a
// copy button with a transient "copied" confirmation
// runs as a client component because the clipboard call, the confirmation
// timer and the mount-time focus all live in the browser

import { useEffect, useRef, useState } from "react";

// transient feedback after a copy attempt; modeled as an object (not a plain
// string) so every click produces a fresh identity – the reset effect below
// keys off it and restarts its timer even when two attempts in a row land on
// the same kind
type CopyFeedback = { kind: "copied" | "error" };

// how long the confirmation stays visible before the label returns to copy
const FEEDBACK_TIMEOUT_MS = 2000;

export function ResultCard({ shortUrl }: { shortUrl: string }) {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // moves focus onto the card when the result appears: the screen reader
  // then reads the card's content and the next tab lands on the link. the
  // parent remounts this component per short url (via key), so every new
  // result refocuses and starts with a clean copy state. focus is the
  // single announcement channel for the result – a live region on top of
  // it would announce the same event twice
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  // schedules the return to the idle label; the cleanup clears the previous
  // timer, so rapid repeated clicks keep restarting the full window instead
  // of racing each other (and unmount cancels the pending reset). a plain
  // effect is the right tool here – it is meant to restart per feedback
  // change; useEffectEvent exists for the opposite case, effects that must
  // keep running across value changes without restarting
  useEffect(() => {
    if (feedback === null) return;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  // copies the short url to the clipboard; the call can reject (permission
  // denied, insecure context) or throw synchronously where the api is
  // missing – the async wrapper funnels both into the catch, the user gets
  // a visible "copy failed" and can still select the link text manually.
  // error details stay out of the ui
  async function copyShortUrl() {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setFeedback({ kind: "copied" });
    } catch {
      setFeedback({ kind: "error" });
    }
  }

  const buttonLabel =
    feedback === null
      ? "Copy"
      : feedback.kind === "copied"
        ? "Copied"
        : "Copy failed";

  return (
    // tabindex -1 makes the container focusable by script only – it never
    // joins the tab order, so keyboard users tab straight to the link
    <div
      ref={cardRef}
      tabIndex={-1}
      className="mt-6 rounded-lg border border-text/10 bg-surface/50 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <p className="text-xs text-text-dim">Your short link</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {/* a real link, so users can open, bookmark or long-press it like
            any other. noopener cuts the opened page's access to
            window.opener – without it the destination could redirect this
            tab to a look-alike page while the user reads the new one
            (tabnabbing); noreferrer additionally keeps the referer header
            out of the request. break-all lets the url wrap instead of
            overflowing the card on narrow screens */}
        <a
          href={shortUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm break-all text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {shortUrl}
        </a>
        {/* min-w keeps the button from resizing while the label swaps, so
            the pointer never slips off it mid-interaction; focus stays on
            the button after a click – only the label changes in place.
            micro-interactions animate transform only, with motion-reduce
            neutralizers as everywhere else */}
        <button
          type="button"
          onClick={copyShortUrl}
          className="min-w-24 rounded-full border border-text/15 bg-surface/50 px-4 py-1.5 text-sm font-medium transition-transform duration-150 ease-snappy hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
        >
          {buttonLabel}
        </button>
      </div>
      {/* visually hidden live region for the copy outcome: a swapped button
          label alone is not reliably announced by screen readers. mounted
          from the start (with empty content) so the change is picked up */}
      <p aria-live="polite" className="sr-only">
        {feedback === null
          ? ""
          : feedback.kind === "copied"
            ? "Copied"
            : "Copy failed – copy the link manually"}
      </p>
    </div>
  );
}
