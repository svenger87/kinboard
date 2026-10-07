import localFont from "next/font/local";

// The three typefaces ship with Kinboard instead of coming from next/font/google,
// which downloads them from Google on every production build — and fails the
// build when that download does. The files live in src/assets/fonts with each
// family's OFL.txt (licensing: NOTICE).
//
// Source: the TTFs in github.com/google/fonts (ofl/bricolagegrotesque,
// ofl/hankengrotesk, ofl/spacemono) at commit 5e8a3ba8, converted to woff2 with
// fontTools and subset to exactly the characters Google Fonts served for these
// families (latin, latin-ext, vietnamese; plus Hanken's few cyrillic-ext
// symbols), so German and French text never falls back. Bricolage's opsz and
// wdth axes are pinned to 14 and 100 as Google pins them — left variable, the
// browser's automatic optical sizing would redraw every heading. Hinting is
// dropped, as in the files Google served to next/font. The result has the same
// advance widths and metrics as those files and the same outlines, except seven
// Bricolage glyphs (» › ¼ ¾ Ï ï ÷) whose components sit up to 0.6 of a font
// unit away (Google rounds its instancing slightly differently).
//
// adjustFontFallback is off because next/font/local would derive the fallback's
// metrics from the file itself, and a variable file's default instance
// (Bricolage's is wght 800) gives different numbers from the ones
// next/font/google used. globals.css declares the same metric-matched Arial
// fallbacks with Google's numbers instead; the fonts list them as `fallback`.
//
// The family name in the generated CSS is the const's name, hence the
// font-named consts behind the exports.
//
// The weight ranges match what Google declared: a weight outside the range
// (font-extralight on the display face, say) clamps to its nearest end, just as
// it picked the nearest of Google's per-weight faces before.

const bricolageGrotesque = localFont({
  src: "../assets/fonts/bricolage-grotesque/BricolageGrotesque-wght.woff2",
  weight: "300 700",
  style: "normal",
  variable: "--font-display",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Bricolage Grotesque Fallback"],
});

const hankenGrotesk = localFont({
  src: "../assets/fonts/hanken-grotesk/HankenGrotesk-wght.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-sans",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Hanken Grotesk Fallback"],
});

const spaceMono = localFont({
  src: [
    { path: "../assets/fonts/space-mono/SpaceMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/space-mono/SpaceMono-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Space Mono Fallback"],
});

export const display = bricolageGrotesque;
export const sans = hankenGrotesk;
export const mono = spaceMono;
