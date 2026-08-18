"use client";

// url-shortening form: wires the createLink server action into react form
// state via useActionState and renders field errors, form-level errors, the
// resulting short link and the list of links created in this session
// runs as a client component because useActionState keeps form state alive
// in the browser between submissions, and the session list plus its
// optimistic pending row live in browser memory only

import { startTransition, useActionState, useOptimistic, useState } from "react";
import { createLink, type ActionState } from "@/lib/actions";
import { RecentLinks, type RecentLinkEntry } from "@/components/RecentLinks";
import { ResultCard } from "@/components/ResultCard";
import { SubmitButton } from "@/components/SubmitButton";

// the form starts in the idle variant of the action state union: nothing to
// show yet besides the empty form
const initialState: ActionState = { status: "idle" };

// caps the session list so it stays glanceable; older links simply fall off
const RECENT_LINKS_LIMIT = 10;

// narrows the row union to its variants once: created rows live in real
// state, pending rows only ever exist inside the optimistic overlay
type CreatedEntry = Extract<RecentLinkEntry, { kind: "created" }>;
type PendingEntry = Extract<RecentLinkEntry, { kind: "pending" }>;

export function ShortenerForm() {
  // the real session list, newest first – only confirmed links ever land
  // here; the list is deliberately memory-only (no accounts means no
  // server-side link/person association, a refresh clears it)
  const [createdLinks, setCreatedLinks] = useState<CreatedEntry[]>([]);

  // optimistic overlay over the real list: while a submit is in flight the
  // pending row sits on top, and outside a submit the overlay equals the
  // real list. explicit type params widen the created-only base list to the
  // full row union without a cast, keeping strict checking intact
  const [recentEntries, addPendingEntry] = useOptimistic<
    RecentLinkEntry[],
    PendingEntry
  >(createdLinks, (current, pending) =>
    [pending, ...current].slice(0, RECENT_LINKS_LIMIT)
  );

  // wraps the server action so the pending row and the real-list commit
  // happen around it without touching the action's state contract – the
  // destination url is read from the form data on the client instead
  async function shortenWithRecentEntry(
    prevState: ActionState,
    formData: FormData
  ): Promise<ActionState> {
    const rawUrl = formData.get("url");
    const targetUrl = typeof rawUrl === "string" ? rawUrl : "";
    // runs inside the form action (an async transition), which is where
    // useOptimistic requires its setter to be called – the row appears in
    // the very render that starts the submit. the id only needs to be
    // unique among in-flight rows (the submit button disables during a
    // request, so in practice there is one), but a random id keeps keys
    // correct without leaning on that assumption
    addPendingEntry({ kind: "pending", id: crypto.randomUUID(), targetUrl });

    const result = await createLink(prevState, formData);

    if (result.status === "success") {
      // commits the confirmed row inside the same transition: react then
      // drops the optimistic overlay and applies this update in a single
      // render, so no frame without the row appears between the pending row
      // vanishing and the real one arriving. the explicit startTransition
      // matters – after an await the transition context does not carry over
      // to state updates on its own
      const createdEntry: CreatedEntry = {
        kind: "created",
        shortUrl: result.shortUrl,
        targetUrl,
      };
      startTransition(() => {
        setCreatedLinks((previous) =>
          [createdEntry, ...previous].slice(0, RECENT_LINKS_LIMIT)
        );
      });
    }
    // on error the transition simply ends: the overlay reverts to the real
    // list, which the failed submit never touched, so the pending row
    // disappears while the form itself shows the error message
    return result;
  }

  // react calls the wrapper with (previousState, formData) on every submit;
  // the returned state replaces the previous one and re-renders the form
  const [state, formAction] = useActionState(shortenWithRecentEntry, initialState);

  // narrows the discriminated union once so the jsx below stays readable –
  // typescript only exposes each field on its matching status variant
  const fieldError =
    state.status === "error" ? state.fieldErrors?.url : undefined;
  const formError = state.status === "error" ? state.message : undefined;
  const shortUrl = state.status === "success" ? state.shortUrl : undefined;

  return (
    // glass card frames the form so it reads as the page's single point of
    // action, sitting on the aurora backdrop that gives the blur its color
    <div className="glass rounded-card w-full max-w-xl p-6 sm:p-8">
      <form action={formAction} className="flex flex-col">
        {/* visible label tied to the input by id – screen readers announce
            it and clicking it focuses the field */}
        <label htmlFor="url" className="text-sm font-medium">
          Long URL
        </label>
        {/* deliberately type="text" (with a url keyboard hint) and no
            required attribute: native browser validation would show messages
            in the browser's own language and duplicate the server-side
            rules – the zod schema on the server stays the single source of
            truth, so error messages are consistent everywhere.
            aria-invalid and aria-describedby point assistive tech at the
            error text below, but only while an error actually exists.
            defaultValue restores the echoed input after an error: react
            resets uncontrolled fields to their defaultValue once the action
            settles, so the echo keeps the user's typing through a failed
            submit while a success (undefined) clears the field */}
        <input
          id="url"
          name="url"
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="https://example.com/a/very/long/path"
          defaultValue={state.status === "error" ? state.submittedUrl : undefined}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "url-error" : undefined}
          className="mt-2 w-full rounded-full border border-text/15 bg-surface/50 px-5 py-2.5 text-sm placeholder:text-text-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        {/* field error slot: stays mounted (and space-reserving) even while
            empty – a live region that only enters the dom together with its
            content is often not announced by screen readers, and the
            reserved height keeps the layout from jumping when text appears */}
        <p
          id="url-error"
          aria-live="polite"
          className="mt-2 min-h-5 text-sm text-danger"
        >
          {fieldError}
        </p>
        {/* form-level error slot (rate limit, unexpected server failure):
            same always-mounted live-region pattern as the field error */}
        <div aria-live="polite">
          {formError ? (
            <p className="mb-3 text-sm text-danger">{formError}</p>
          ) : null}
        </div>
        <SubmitButton />
      </form>
      {/* success: the result card takes focus on mount, which announces the
          new link (no live region here – focus plus live region would
          announce the same event twice). keying by the short url remounts
          the card per result, so each new link refocuses and starts with a
          clean copy state */}
      {shortUrl ? <ResultCard key={shortUrl} shortUrl={shortUrl} /> : null}
      {/* session list below the result card: the newest link shows in both
          on purpose – the card is transient action feedback with the copy
          affordance (replaced by the next submit), the list is the session's
          durable record, and the pending row must confirm into a real row in
          place rather than vanish into the card */}
      <RecentLinks entries={recentEntries} />
    </div>
  );
}
