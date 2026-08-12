// home page (server component) – hero composition around the shortener form
// stays fully server-rendered: everything here is static text, so the only
// javascript shipped to the browser is the form island itself

import { ShortenerForm } from "@/components/ShortenerForm";

export default function Home() {
  return (
    // fills the viewport (flex-1 against the body's flex column) and centers
    // the hero; generous padding keeps the glass card off the edges on
    // small screens
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16">
      <section className="flex max-w-xl flex-col items-center text-center">
        {/* logo pill stands in for a full navbar – the page has a single
            action, so extra chrome would only dilute the hierarchy. the logo
            is two perfectly stacked copies of the same text: the base span
            carries the accent gradient, the overlay carries the reversed
            gradient and briefly fades in every few seconds (a css-only
            "phase shift" – see the logo-phase utility). the overlay is
            aria-hidden so screen readers announce "jkl" only once */}
        <p className="relative rounded-full border border-text/15 px-[1em] py-[0.375em] font-mono text-2xl">
          <span className="bg-linear-to-r from-accent to-accent-2 bg-clip-text text-transparent">
            jkl
          </span>
          {/* absolute inset-0 plus the pill's own padding makes the overlay
              glyphs sit exactly on top of the base glyphs – same font, same
              size inherited from the pill, so the two layers align
              pixel-perfectly. padding uses em, so it follows text-* and stays
      identical across both layers by construction */}
          <span
            aria-hidden="true"
            className="logo-phase absolute inset-0 px-[1em] py-[0.375em] bg-linear-to-r from-accent-2 to-accent bg-clip-text text-transparent"
          >
            jkl
          </span>
        </p>
        {/* tracking-tight pulls large glyphs together; text-balance evens
            out line lengths so the heading never strands a single word.
            the heading stays monochrome on purpose – the logo above holds
            the page's only color accent, which keeps the hierarchy calm */}
        <h1 className="mt-6 text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
          Shorten a link
        </h1>
        <p className="mt-4 text-text-dim text-pretty">
          Paste a long url below to generate a clean short link.
        </p>
      </section>

      <ShortenerForm />

      {/* security microcopy: tells users up front what the service accepts
          and that redirects stay revocable (temporary 307 redirects are a
          deliberate anti-abuse choice: nothing gets cached permanently in
          browsers, so a malicious link can always be switched off) */}
      <p className="max-w-md text-center text-xs text-text-dim text-pretty">
        Only http and https links are accepted. Redirects are temporary (307),
        so a malicious link can always be switched off.
      </p>
    </main>
  );
}
