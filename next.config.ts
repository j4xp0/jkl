// configures next.js at the framework level: react compiler + http security headers
// security headers live here (not in middleware) because they are static – zero runtime logic
import type { NextConfig } from "next";

// security headers applied to every response
// content-security-policy is intentionally left out for now – it requires
// per-request nonces for scripts, so it ships later, starting in report-only mode
const securityHeaders = [
  {
    // forces the browser to talk to us only over https for 2 years (63072000 s),
    // covering all subdomains; protects against protocol-downgrade and mitm attacks
    // (an attacker on open wifi cannot silently redirect the victim to plain http);
    // "preload" opts the domain into browsers' built-in hsts lists;
    // note: browsers ignore hsts on plain-http localhost – it activates on https (vercel)
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // stops the browser from mime-sniffing: a response declared as text/plain or image
    // never gets reinterpreted (and executed) as html/javascript, which blocks a class
    // of attacks where uploaded or reflected content masquerades as a script
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // limits how much of the current url leaks in the referer header:
    // same-origin gets the full url, cross-origin gets only our origin,
    // and downgraded (https→http) requests get nothing – prevents leaking
    // slugs or query strings to the sites our short links redirect to
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // forbids embedding this app in any <iframe>; defends against clickjacking,
    // where an invisible frame tricks the user into clicking our ui
    // (a shortener form in a hidden frame could be abused to create links)
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // disables powerful browser apis this app never uses; even if an attacker
    // injects markup, the browser refuses camera/microphone/location access
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // enables the react compiler, which auto-memoizes components,
  // so the code never needs manual useMemo/useCallback/React.memo
  reactCompiler: true,

  // removes the default "x-powered-by: next.js" response header;
  // advertising the framework is information disclosure (fingerprinting) –
  // it helps attackers pick exploits matching our stack for free
  poweredByHeader: false,

  // attaches the security headers to every route ("/(.*)" matches all paths),
  // including future /{slug} redirects and 404 responses – no response ships bare
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
