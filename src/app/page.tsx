// home page (server component) — temporary design token demo until the real
// shortener ui ships; exercises the full token set, the glass surface and the
// motion rules so both color modes can be checked at a glance

// swatch data lives outside the component so it is created once per module
// load, not on every render; class names must stay full literals (no string
// concatenation) because tailwind's scanner only picks up complete class names
const colorSwatches: { name: string; swatchClass: string }[] = [
  { name: "bg", swatchClass: "bg-bg" },
  { name: "surface", swatchClass: "bg-surface" },
  { name: "text", swatchClass: "bg-text" },
  { name: "text-dim", swatchClass: "bg-text-dim" },
  { name: "accent", swatchClass: "bg-accent" },
  { name: "accent-2", swatchClass: "bg-accent-2" },
  { name: "glass-highlight", swatchClass: "bg-glass-highlight" },
];

export default function Home() {
  return (
    // fills the viewport (flex-1 against the body's flex column) and centers
    // the demo sections; generous padding keeps the glass card off the edges
    // on small screens
    <main className="flex flex-1 flex-col items-center justify-center gap-12 px-6 py-16">
      {/* type hierarchy demo: strong primary heading vs dimmed supporting copy */}
      <section className="max-w-xl text-center">
        {/* tracking-tight pulls large glyphs together (big sizes look loose
            otherwise); text-balance makes the browser even out line lengths
            so the heading never leaves a single orphan word on its own line */}
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          One token set, two color modes
        </h1>
        {/* text-dim carries secondary copy; text-pretty avoids ugly last-line
            breaks in paragraphs (cheaper than text-balance, meant for body text) */}
        <p className="mt-4 text-text-dim text-pretty">
          Everything on this page – background, glass, text and accents – is
          driven by design tokens. Switch your system theme and the whole page
          follows, with no reload and no javascript.
        </p>
      </section>

      {/* glass surface demo: sits directly on the aurora backdrop from the
          layout, which gives the backdrop blur something colorful to smear */}
      <section className="glass rounded-card w-full max-w-md p-6">
        <h2 className="font-semibold tracking-tight">Frosted glass surface</h2>
        <p className="mt-2 text-sm text-text-dim text-pretty">
          This card blurs the aurora behind it and catches a thin line of light
          on its top edge. Tilt your eyes – the border stays visible in both
          modes because it is mixed from the text token.
        </p>
        {/* accent button with a purely transform-based micro-interaction:
            transform and opacity are the only properties cheap enough to
            animate without layout or paint work. the label uses the bg token
            because bg always sits at the opposite lightness pole of the
            accent, which keeps the contrast aa-safe in both modes.
            motion-reduce variants neutralize every movement for users with
            "reduce motion" enabled — the button then changes nothing on
            hover/press. the button is decorative for now and gains a real
            action when the shortener form ships */}
        <button
          type="button"
          className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-bg transition-transform duration-150 ease-snappy hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
        >
          Shorten a link
        </button>
      </section>

      {/* color token swatches: one square per token so both modes can be
          eyeballed for contrast and hue drift in seconds */}
      <section aria-label="color token swatches">
        <ul className="flex max-w-xl flex-wrap items-start justify-center gap-x-5 gap-y-4">
          {colorSwatches.map(({ name, swatchClass }) => (
            <li key={name} className="flex flex-col items-center gap-1.5">
              {/* the hairline border is mixed from the text token so swatches
                  that match the page background (bg, glass-highlight) do not
                  vanish into it */}
              <span
                className={`${swatchClass} size-10 rounded-lg border border-text/15`}
              />
              <span className="font-mono text-xs text-text-dim">{name}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
