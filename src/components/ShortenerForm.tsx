"use client";

// url-shortening form: wires the createLink server action into react form
// state via useActionState and renders field errors, form-level errors and
// the resulting short link
// runs as a client component because useActionState keeps form state alive
// in the browser between submissions

import { useActionState } from "react";
import { createLink, type ActionState } from "@/lib/actions";
import { ResultCard } from "@/components/ResultCard";
import { SubmitButton } from "@/components/SubmitButton";

// the form starts in the idle variant of the action state union: nothing to
// show yet besides the empty form
const initialState: ActionState = { status: "idle" };

export function ShortenerForm() {
  // react calls createLink with (previousState, formData) on every submit;
  // the returned state replaces the previous one and re-renders the form
  const [state, formAction] = useActionState(createLink, initialState);

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
    </div>
  );
}
