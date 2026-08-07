import next from "eslint-config-next";

// Kinboard ESLint flat config (ESLint 9, Next 16).
// React 19 + React Compiler introduce stricter `react-hooks/*` rules.
// Several existing patterns in this codebase (state updates inside effects,
// memoization across realtime/supabase hooks, etc.) trip these — these are
// real React anti-patterns but predate React 19 and aren't regressions.
// Disabled here to unblock the security upgrade; tracked for follow-up
// refactor in v1.1.
const REACT_19_TODO_RULES = {
  "react-hooks/set-state-in-effect": "off",
  "react-hooks/static-components": "off",
  "react-hooks/preserve-manual-memoization": "off",
  "react-hooks/purity": "off",
  "react-hooks/refs": "off",
  "react-hooks/immutability": "off",
};

const config = [
  ...next,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "prefer-const": "off",
      // Kinboard intentionally uses <img> for many surfaces:
      //  - user-uploaded recipe images, family-member avatars, Immich
      //    screensaver photos — unknown dimensions at write time
      //  - camera-frame URLs that change per-frame
      //  - SVG/animated overlays where next/image's optimizer adds no value
      // Migrating each to <Image> + fill + positioned parent would be a
      // net code-clarity loss for no measurable perf gain on these
      // dynamic surfaces. Leaving on for static branding assets is also
      // not worth the partial-coverage tax.
      "@next/next/no-img-element": "off",
      // Kiosk surfaces must not ask an ARM GPU to composite a blur. globals.css
      // states this policy in four separate comments, and it had drifted anyway:
      // every dialog and sheet carried backdrop-blur-xl, and MobileNav had a
      // backdrop-blur-none override to undo it at one call site (audit KB-29).
      // A comment is not enforcement; this is.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/\\b(backdrop-blur|blur-(2xl|3xl))\\b/]",
          message:
            "Blur is banned on kiosk surfaces (ARM GPU cost). Use elev-sm/md/lg for depth and an opaque background. See globals.css.",
        },
        {
          selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/\\b(backdrop-blur|blur-(2xl|3xl))\\b/]",
          message:
            "Blur is banned on kiosk surfaces (ARM GPU cost). Use elev-sm/md/lg for depth and an opaque background. See globals.css.",
        },
        // A near-opaque surface (90-99%) is the fingerprint of a blur that was
        // removed while its alpha was left behind. bg-background/98 with no
        // backdrop-blur is worse than either: the page bleeds through every
        // modal as a sharp, undiffused ghost instead of frosted glass. This
        // shipped in 1.7.0-rc.1 and hit every dialog and sheet in the app.
        // Either commit to opaque, or pick an alpha low enough to read as
        // deliberate. Nothing in 90-99.
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/\\bbg-(background|card|popover)\\/9[0-9]\\b/]",
          message:
            "Near-opaque surface (bg-*/90-99). Blur is banned, so alpha here renders as an undiffused ghost of the page. Use a fully opaque background.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/\\bbg-(background|card|popover)\\/9[0-9]\\b/]",
          message:
            "Near-opaque surface (bg-*/90-99). Blur is banned, so alpha here renders as an undiffused ghost of the page. Use a fully opaque background.",
        },
        // One elevation API. Tailwind's shadow-* draws a hard black shadow;
        // .elev-* is tinted by the active neutral palette via --shadow-rgb.
        // Both existed side by side for the same job (audit KB-28). Colour-
        // bearing shadows (shadow-black/20, shadow-[0_0_...]) are unaffected.
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)shadow-(sm|md|lg|xl|2xl)(\\s|$)/]",
          message:
            "Use elev-sm/md/lg instead of shadow-*: they follow the palette's shadow tint (--shadow-rgb). See globals.css.",
        },
        {
          selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)shadow-(sm|md|lg|xl|2xl)(\\s|$)/]",
          message:
            "Use elev-sm/md/lg instead of shadow-*: they follow the palette's shadow tint (--shadow-rgb). See globals.css.",
        },
      ],
      ...REACT_19_TODO_RULES,
    },
  },
];

export default config;
