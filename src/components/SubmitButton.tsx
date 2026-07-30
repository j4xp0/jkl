"use client";

// submit button for the shortener form: reflects the in-flight state of the
// parent form so the user gets feedback and cannot double-submit
// lives in its own component because useFormStatus only reports the status
// of a parent <form> – called in the same component that renders the form
// element it would see nothing

import { useFormStatus } from "react-dom";

export function SubmitButton() {
  // pending stays true from the moment the form submits until the server
  // action settles, with no manual loading state anywhere
  const { pending } = useFormStatus();

  return (
    // disabled blocks re-submits while the action runs and the label swap
    // makes the wait visible. micro-interactions animate only transform
    // (cheap: no layout or paint work), every movement has a motion-reduce
    // neutralizer for users who opt out of motion, and the disabled variants
    // cancel the hover lift so an inert button does not pretend to be
    // interactive. the label uses the bg token because bg always sits at the
    // opposite lightness pole of the accent, keeping contrast aa-safe in
    // both color modes
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-bg transition-transform duration-150 ease-snappy hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
    >
      {pending ? "Shortening…" : "Shorten link"}
    </button>
  );
}
