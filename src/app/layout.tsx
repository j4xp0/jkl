import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "jkl – link shortener",
  description: "Paste a long link, get a short one.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang matches the ui language — screen readers pick pronunciation from it
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* decorative aurora backdrop: a few large, heavily blurred color
            blobs sitting behind all content — glass surfaces need something
            colorful underneath to blur, otherwise they read as flat gray.
            static for now; subtle motion may ship with the visual polish pass */}
        {/* fixed + inset-0 pins the layer to the viewport so it never scrolls
            with content; -z-10 paints it behind everything; overflow-hidden
            clips blobs that bleed past the edges (prevents horizontal scroll);
            pointer-events-none keeps it from swallowing clicks and aria-hidden
            hides this purely visual layer from screen readers */}
        <div
          aria-hidden="true"
          className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
        >
          {/* blob colors come from the accent tokens with lowered opacity;
              light-dark() inside the tokens adapts them to the active mode */}
          <div className="absolute -top-32 -left-32 size-[36rem] rounded-full bg-accent/30 blur-3xl" />
          <div className="absolute top-1/3 -right-40 size-[32rem] rounded-full bg-accent-2/25 blur-3xl" />
          <div className="absolute -bottom-40 left-1/4 size-[30rem] rounded-full bg-accent/20 blur-3xl" />
        </div>
        {children}
      </body>
    </html>
  );
}
