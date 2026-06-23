# Plan 8 — Redesign: Onboarding / Join / Setup ("Salbei / Leinen")

For agentic workers: use superpowers:subagent-driven-development.

## Goal
Bring the `/join` landing and the `/setup/*` wizard onto the "Salbei / Leinen" redesign foundation: a welcome-style join landing (logo badge, eyebrow, big `font-display` title, two `size="kiosk"` CTAs), a 6-cell `CodeInput`, a curated `PersonColorPicker` driven by a shared `PERSON_COLORS` constant, flat cards (no GlassCard), and `--primary` (month accent) instead of the hard-coded `month-primary`/`variant="month"` everywhere. All existing hooks and routing stay exactly as-is — this is a visual layer change.

## Architecture
- `/join` and `/setup/*` are NO_NAV, full-screen bespoke surfaces. They already exist; we restyle them. No new routes.
- `/join` keeps its single `useState<"join"|"create">` mode. The redesign adds a **welcome state**: when the user has not yet picked a mode (and is not a recognized device / fresh install), show the welcome hero + two CTAs that set `mode`. Once a mode is chosen, show the corresponding form. `isFreshInstall` continues to force `create`.
- Two new shared building blocks: `PERSON_COLORS` (constant + types in `lib/person-color.ts`) and two new client components — `PersonColorPicker` and `CodeInput`.
- The setup wizard shell (`layout`, `wizard-progress`, `wizard-step-footer`) and all five step pages are swept: `GlassCard` → flat `Card`, `month-primary` → `primary`, `variant="month"` → default, kiosk-friendly CTAs.

## Tech Stack
Next.js 16 (App Router), React 19, Tailwind, shadcn/ui, framer-motion, next-intl (EN+DE+FR; key parity is a CI gate). Reuse Foundation + Plan 2–7 primitives: `PersonAvatar`, `Button` (default = month accent; `size="kiosk"` = `h-16 px-6 text-base`; `variant="outline"`), `Card`/`CardContent` (flat, `rounded-2xl border bg-card elev-md`), `Input`, `Badge`, `.icon-badge`, `.page-gradient`, `.text-kiosk-*`, person-color helpers (`personTint`/`personStrongTint`/`personText`), `LocaleSwitcher`. The `--person-*` CSS tokens (coral/amber/citron/forest/teal/sky/indigo/lilac/berry/clay) already ship from Foundation in `globals.css`.

## Global Constraints
- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification = lint+tsc+structural self-review; live smoke deferred to user. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-7 components; never hardcode accent hex (primary/tints); per-person colors via the curated `PERSON_COLORS` / `--person-*` tokens / inline; NO literal `text-white` on primary surfaces (`text-primary-foreground`; PersonAvatar's white initial on person color is fine). Lucide stroke 1.75. Code cells `font-mono`.
- NO glass/backdrop-blur on app surfaces (removes GlassCard from join/setup; LocaleSwitcher's own pill may keep its style or flatten — your call, document). Theme-following (NOT dark-forced).
- Touch targets ≥44px (kiosk CTAs `size="kiosk"`). next-intl EN/DE/FR parity (CI gate). NO fake/non-functional features (no keypad for alphanumeric codes; no fake expiry timer).
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

### Deferred (resolved by the controller — do NOT build)
- **Numeric keypad on join-mobile**: the join code alphabet is `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (alphanumeric, per `generateJoinCode()` in `lib/utils.ts`), so an on-screen numeric keypad cannot enter it. Mobile already surfaces a native keyboard for the cells. Build the 6-cell input WITHOUT a keypad. Note in changelog.
- **Kiosk "show this code" screen + expiry timer**: `families.join_code` is a static string with no expiry column. A countdown would be fake and the screen doesn't exist. Out of scope (needs a DB migration). Note in changelog.

---

### Task 1 — `PERSON_COLORS` constant + `PersonColorPicker` component

**Files**
- `webapp/src/lib/person-color.ts` (edit — append constant + type)
- `webapp/src/components/person-color-picker.tsx` (new)

**Interfaces**
- Produces: `PERSON_COLORS: readonly PersonColor[]` where `PersonColor = { key: string; hex: string }`; `PersonColorPicker` component `{ value: string; onChange: (hex: string) => void; className?: string }`.
- Consumes: `cn` from `@/lib/utils`; color names i18n'd via `useTranslations("personColor")` (added in Task 6 — until then the keys resolve to the key string, which next-intl tolerates at runtime but `npm run lint` does not check; we add the keys in Task 6 so final state is clean). To keep each task independently lint-clean, **use the English token names as `aria-label` directly in this task** (no `useTranslations`), and Task 6 is purely additive (changelog + LocaleSwitcher aria + welcome/help keys). This avoids a missing-namespace dependency.

Steps:
- [ ] Append to `webapp/src/lib/person-color.ts` (after the existing helpers), the curated palette that mirrors the `--person-*` tokens already in `globals.css`:

```ts
/**
 * Curated default person palette (Salbei / Leinen redesign). Hex values match
 * the `--person-*` tokens in globals.css. `key` is a stable identifier used for
 * i18n labels (messages → `personColor.<key>`) and as a React list key.
 */
export interface PersonColor {
  key: string;
  hex: string;
}

export const PERSON_COLORS: readonly PersonColor[] = [
  { key: "coral", hex: "#E2664E" },
  { key: "amber", hex: "#D98A2B" },
  { key: "citron", hex: "#8E9B36" },
  { key: "forest", hex: "#3FA56B" },
  { key: "teal", hex: "#2E9BA6" },
  { key: "sky", hex: "#4A8FD6" },
  { key: "indigo", hex: "#6E72C9" },
  { key: "lilac", hex: "#A968C4" },
  { key: "berry", hex: "#D667A0" },
  { key: "clay", hex: "#B07B53" },
] as const;
```

- [ ] Create `webapp/src/components/person-color-picker.tsx` with this exact content:

```tsx
"use client";

import { cn } from "@/lib/utils";
import { PERSON_COLORS } from "@/lib/person-color";

interface PersonColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}

export function PersonColorPicker({ value, onChange, className }: PersonColorPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Color"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {PERSON_COLORS.map(({ key, hex }) => {
        const selected = value.toLowerCase() === hex.toLowerCase();
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={key}
            onClick={() => onChange(hex)}
            className={cn(
              "size-7 rounded-full transition-[box-shadow,transform] active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected && "ring-2 ring-offset-2 ring-offset-card",
            )}
            style={{
              backgroundColor: hex,
              ...(selected ? { ["--tw-ring-color" as string]: hex } : {}),
            }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(onboarding): add PERSON_COLORS palette + PersonColorPicker component`

---

### Task 2 — `CodeInput` component (6-cell join-code entry)

**Files**
- `webapp/src/components/code-input.tsx` (new)

**Interfaces**
- Produces: `CodeInput` component `{ value: string; onChange: (v: string) => void; length?: number; onComplete?: () => void; className?: string }`. Emits the full uppercased string via `onChange`; calls `onComplete` once the string reaches `length`. Alphanumeric only (the join-code alphabet; we allow A–Z and 0–9, uppercase).
- Consumes: `cn` from `@/lib/utils`; React refs.

Steps:
- [ ] Create `webapp/src/components/code-input.tsx` with this exact content:

```tsx
"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface CodeInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  onComplete?: () => void;
  className?: string;
}

/** Allowed join-code characters: A–Z and 0–9 (matches generateJoinCode). */
function sanitize(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function CodeInput({
  value,
  onChange,
  length = 6,
  onComplete,
  className,
}: CodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  const commit = (next: string) => {
    const clipped = sanitize(next).slice(0, length);
    onChange(clipped);
    if (clipped.length === length) onComplete?.();
  };

  const focusCell = (i: number) => {
    const clamped = Math.max(0, Math.min(length - 1, i));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  };

  const handleChange = (index: number, raw: string) => {
    const cleaned = sanitize(raw);
    if (!cleaned) return;
    const arr = chars.slice();
    // Typing into a cell may paste multiple chars; spread across cells.
    let cursor = index;
    for (const ch of cleaned) {
      if (cursor >= length) break;
      arr[cursor] = ch;
      cursor += 1;
    }
    commit(arr.join(""));
    focusCell(cursor);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = chars.slice();
      if (arr[index]) {
        arr[index] = "";
        commit(arr.join(""));
      } else if (index > 0) {
        arr[index - 1] = "";
        commit(arr.join(""));
        focusCell(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusCell(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusCell(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const cleaned = sanitize(e.clipboardData.getData("text"));
    if (!cleaned) return;
    commit(cleaned);
    focusCell(Math.min(cleaned.length, length - 1));
  };

  return (
    <div className={cn("flex gap-2", className)}>
      {chars.map((char, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={char}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Character ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={cn(
            "h-16 flex-1 rounded-xl border bg-card text-center font-mono text-2xl font-bold uppercase text-foreground",
            "transition-colors focus-visible:outline-none focus-visible:border-primary",
            "focus-visible:ring-2 focus-visible:ring-primary/30",
            char ? "border-primary/40" : "border-border",
          )}
        />
      ))}
    </div>
  );
}
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(onboarding): add 6-cell CodeInput for join-code entry`

---

### Task 3 — `/join` welcome rework + flat restyle

**Files**
- `webapp/src/app/join/page.tsx` (edit)

**Interfaces**
- Consumes: `CodeInput` (Task 2), `Card`/`CardContent` (flat), `Button` (default + `size="kiosk"` + `variant="outline"`), existing hooks (`useJoinFamily`, `useCreateFamilyWithDevice`, `useFindDeviceByFingerprint`, `useQuickRejoin`), `useTranslations("join")`.
- Produces: a welcome landing state + restyled join/create forms. All hook calls and navigation (`router.push("/")`, `router.push("/setup/people")`) unchanged.

Steps:
- [ ] Add a third welcome sub-state. Add a `useState` flag for whether the user has chosen a mode yet. Replace the import line:

```tsx
import { GlassCard } from "@/components/ui/card";
import { Users, ArrowRight, Sparkles, RefreshCw, PartyPopper } from "lucide-react";
```

with:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { CodeInput } from "@/components/code-input";
import { Users, ArrowRight, Sparkles, RefreshCw, PartyPopper, Plus, KeyRound } from "lucide-react";
```

- [ ] After the existing `const [mode, setMode] = useState<"join" | "create">("join");` line add:

```tsx
  // Welcome gate: until the user picks a CTA (or is recognized / fresh-install
  // forced into create), show the welcome hero instead of a form.
  const [modeChosen, setModeChosen] = useState(false);
```

- [ ] In the fresh-install effect, when `data.hasFamilies === false`, also mark the mode chosen so the welcome CTAs are skipped (fresh install has only one path). Replace:

```tsx
        if (data.hasFamilies === false) {
          setIsFreshInstall(true);
          setMode("create");
        }
```

with:

```tsx
        if (data.hasFamilies === false) {
          setIsFreshInstall(true);
          setMode("create");
          setModeChosen(true);
        }
```

- [ ] Replace the background + decorative block (the `<div className="fixed inset-0 bg-gradient-to-br from-month-primary/10 ..."` and the two blurred decorative `<div>`s) with the flat page gradient:

```tsx
      {/* Background — flat page gradient, theme-following, no glass */}
      <div className="page-gradient" />
```

(Delete the two `absolute … blur-3xl` decorative divs entirely.)

- [ ] Replace the logo/title header block (the `<div className="text-center mb-8">…</div>` containing the `Users` badge, `t("title")`, `t("tagline")`) with a welcome-aware header. When `!modeChosen && recognizedDevices.length === 0 && !isFreshInstall`, render the full welcome hero (eyebrow + big title + tagline + two kiosk CTAs); otherwise render a compact header. Replace the block with:

```tsx
        {/* Header / Welcome hero */}
        {!modeChosen && recognizedDevices.length === 0 && !isFreshInstall ? (
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center size-20 icon-badge rounded-3xl mb-6">
              <Users className="size-10" strokeWidth={1.75} />
            </div>
            <p className="text-kiosk-label text-primary mb-3">{t("welcomeEyebrow")}</p>
            <h1 className="text-4xl font-display font-medium tracking-tight mb-3">
              {t("welcomeTitle")}
            </h1>
            <p className="text-muted-foreground text-base leading-relaxed max-w-sm mx-auto mb-8">
              {t("welcomeBody")}
            </p>
            <div className="flex flex-col gap-3">
              <Button
                size="kiosk"
                className="w-full"
                onClick={() => {
                  setMode("create");
                  setModeChosen(true);
                }}
              >
                <Plus className="size-5" strokeWidth={1.75} />
                {t("welcomeCreateCta")}
              </Button>
              <Button
                size="kiosk"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setMode("join");
                  setModeChosen(true);
                }}
              >
                <KeyRound className="size-5" strokeWidth={1.75} />
                {t("welcomeJoinCta")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center size-16 icon-badge rounded-2xl mb-4">
              <Users className="size-8" strokeWidth={1.75} />
            </div>
            <h1 className="text-2xl font-display font-medium tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-2">{t("tagline")}</p>
          </div>
        )}
```

- [ ] In the welcome state, suppress the mode tabs + form card (they only render once a mode is chosen or the device is recognized / fresh-install). Wrap the existing mode-tabs block + form card so they only show when `(modeChosen || isFreshInstall) && recognizedDevices.length === 0` OR the recognized-devices / banners always show. Concretely: change the mode-tabs guard from `{!isFreshInstall && (` to:

```tsx
        {!isFreshInstall && modeChosen && recognizedDevices.length === 0 && (
```

- [ ] Wrap the form `Card` so it only renders after a mode is chosen. Change the opening of the form card. Replace:

```tsx
        {/* Form Card */}
        <GlassCard className="p-6">
          {mode === "join" ? (
```

with:

```tsx
        {/* Form Card — only after a mode is chosen (or fresh install forces create) */}
        {(modeChosen || isFreshInstall) && recognizedDevices.length === 0 && (
        <Card>
          <CardContent className="p-6">
          {mode === "join" ? (
```

and replace the matching close of that card. Replace:

```tsx
            </form>
          )}
        </GlassCard>
```

with:

```tsx
            </form>
          )}
          </CardContent>
        </Card>
        )}
```

- [ ] Swap the join-code `<Input>` for `CodeInput`. Replace the entire join-code field block:

```tsx
              <div className="flex flex-col gap-2">
                <label htmlFor="join-code" className="text-sm font-medium">{t("joinCodeLabel")}</label>
                <Input
                  id="join-code"
                  placeholder={t("joinCodePlaceholder")}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="text-center text-2xl font-mono tracking-[0.5em] uppercase h-14"
                  maxLength={6}
                  required
                />
                <p className="text-xs text-muted-foreground text-center">
                  {t("joinCodeHint")}
                </p>
              </div>
```

with:

```tsx
              <div className="flex flex-col gap-2">
                <label htmlFor="join-code" className="text-sm font-medium">{t("joinCodeLabel")}</label>
                <CodeInput value={joinCode} onChange={setJoinCode} length={6} />
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5 mt-1">
                  {t("joinCodeHint")}
                </p>
              </div>
```

- [ ] Restyle the join submit `Button`: drop `variant="month"` (default is the month accent now) and bump to kiosk size. Replace:

```tsx
              <Button
                type="submit"
                variant="month"
                size="lg"
                className="w-full"
                disabled={loading || joinCode.length < 6}
              >
```

with:

```tsx
              <Button
                type="submit"
                size="kiosk"
                className="w-full"
                disabled={loading || joinCode.length < 6}
              >
```

- [ ] Restyle the create submit `Button` the same way. Replace:

```tsx
              <Button
                type="submit"
                variant="month"
                size="lg"
                className="w-full"
                disabled={loading || !familyName}
              >
```

with:

```tsx
              <Button
                type="submit"
                size="kiosk"
                className="w-full"
                disabled={loading || !familyName}
              >
```

- [ ] Sweep the remaining `GlassCard` + `month-primary`/`variant="month"` usages in the banners (fresh-install, demo, quick-rejoin, recovery-hint). For each, change `<GlassCard className="…">` → `<Card className="…">` and its close `</GlassCard>` → `</Card>`; change `text-month-primary` → `text-primary`, `border-month-primary/30` → `border-primary/30`, `bg-month-primary/5` → `bg-primary/5`, and the two `variant="month"` buttons (demo "use code", rejoin "sign back in") → remove `variant` (default) keeping `size="sm"`. Apply via `replace_all` where the token strings are identical, otherwise per-block.
- [ ] In the recovery-hint, since the recovery card now only shows after a mode is chosen, change its guard from `mode === "join"` to `modeChosen && mode === "join"` so it doesn't appear on the welcome screen. Replace:

```tsx
        {!isFreshInstall &&
          !isCheckingFingerprint &&
          recognizedDevices.length === 0 &&
          mode === "join" && (
```

with:

```tsx
        {!isFreshInstall &&
          modeChosen &&
          !isCheckingFingerprint &&
          recognizedDevices.length === 0 &&
          mode === "join" && (
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(onboarding): welcome landing + flat redesign for /join with 6-cell code input`

---

### Task 4 — `setup/people` restyle (PersonColorPicker + PersonAvatar + flat)

**Files**
- `webapp/src/app/setup/people/page.tsx` (edit)

**Interfaces**
- Consumes: `PersonColorPicker` + `PERSON_COLORS` (Task 1), `PersonAvatar`, `Card`/`CardContent` (flat), existing `useCreatePerson` (`{ name, color, avatar_url?, is_child? }`), draft state logic unchanged.
- Produces: redesigned person-list step. `handleSave` and draft logic untouched.

Steps:
- [ ] Replace the imports block:

```tsx
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { toast } from "sonner";
import { useCreatePerson } from "@/hooks";
import { safeRandomUUID } from "@/lib/uuid";
```

with:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { PersonColorPicker } from "@/components/person-color-picker";
import { PersonAvatar } from "@/components/person-avatar";
import { PERSON_COLORS } from "@/lib/person-color";
import { toast } from "sonner";
import { useCreatePerson } from "@/hooks";
import { safeRandomUUID } from "@/lib/uuid";
```

- [ ] Replace the local `DEFAULT_COLORS` + `makeDraft` so new drafts cycle the curated palette:

```tsx
const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

function makeDraft(seed: number): Draft {
  return {
    id: safeRandomUUID(),
    name: "",
    color: DEFAULT_COLORS[seed % DEFAULT_COLORS.length],
  };
}
```

with:

```tsx
function makeDraft(seed: number): Draft {
  return {
    id: safeRandomUUID(),
    name: "",
    color: PERSON_COLORS[seed % PERSON_COLORS.length].hex,
  };
}
```

- [ ] Replace the card + draft-row markup. Replace:

```tsx
      <GlassCard className="p-6 md:p-8">
        <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

        <div className="flex flex-col gap-3">
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <input
                type="color"
                value={d.color}
                onChange={(e) => updateDraft(d.id, { color: e.target.value })}
                className="size-10 rounded-lg border-0 cursor-pointer"
                aria-label="Color"
              />
              <Input
                placeholder={t("namePlaceholder")}
                value={d.name}
                onChange={(e) => updateDraft(d.id, { name: e.target.value })}
                className="flex-1"
              />
              {drafts.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(d.id)}
                  aria-label={t("remove")}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={addRow} className="mt-3">
          <Plus className="size-4 mr-2" />
          {t("addAnother")}
        </Button>
      </GlassCard>
```

with:

```tsx
      <Card>
        <CardContent className="p-6 md:p-8">
          <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

          <div className="flex flex-col gap-3">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 md:p-4"
              >
                <PersonAvatar name={d.name || "?"} color={d.color} size={44} />
                <div className="flex flex-1 flex-col gap-2 min-w-0">
                  <Input
                    placeholder={t("namePlaceholder")}
                    value={d.name}
                    onChange={(e) => updateDraft(d.id, { name: e.target.value })}
                  />
                  <PersonColorPicker
                    value={d.color}
                    onChange={(hex) => updateDraft(d.id, { color: hex })}
                  />
                </div>
                {drafts.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(d.id)}
                    aria-label={t("remove")}
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 py-3.5 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06]"
          >
            <Plus className="size-5" strokeWidth={1.75} />
            {t("addAnother")}
          </button>
        </CardContent>
      </Card>
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(onboarding): curated color picker + avatars + flat cards on setup/people`

---

### Task 5 — Setup shell + remaining steps sweep

**Files**
- `webapp/src/app/setup/layout.tsx` (edit)
- `webapp/src/components/setup/wizard-progress.tsx` (edit)
- `webapp/src/components/setup/wizard-step-footer.tsx` (edit)
- `webapp/src/app/setup/calendar/page.tsx` (edit)
- `webapp/src/app/setup/homeassistant/page.tsx` (edit)
- `webapp/src/app/setup/weather/page.tsx` (edit)
- `webapp/src/app/setup/done/page.tsx` (edit)

**Interfaces**
- Consumes: flat `Card`/`CardContent`, `Button` (default + kiosk), existing wizard hooks. Step logic, props, and navigation unchanged.
- Produces: tokenized (`primary`), flat, kiosk-friendly setup surface.

Steps (layout):
- [ ] In `setup/layout.tsx`, flatten the background. Replace:

```tsx
    <main className="min-h-screen flex flex-col bg-gradient-to-br from-month-primary/10 via-background to-background safe-area-inset">
```

with:

```tsx
    <main className="min-h-screen flex flex-col safe-area-inset relative">
      <div className="page-gradient" />
```

and add a matching close — change the final `</main>` close to include the now-required wrapper note (no extra wrapper element needed since `page-gradient` is `fixed inset-0`; the `<header>` and content already sit above it because they come after in DOM and `page-gradient` is `pointer-events-none`). Ensure header/content get `relative z-10`: change the `<header className="flex items-center justify-between px-6 py-4">` to `<header className="relative z-10 flex items-center justify-between px-6 py-4">` and `<div className="flex-1 flex items-start justify-center px-6 py-8">` to `<div className="relative z-10 flex-1 flex items-start justify-center px-6 py-8">`.

Steps (wizard-progress):
- [ ] In `wizard-progress.tsx`, tokenize the fill + thicken the bar. Replace:

```tsx
      <div className="flex gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= idx ? "bg-month-primary" : "bg-secondary",
            )}
          />
        ))}
      </div>
```

with:

```tsx
      <div className="flex gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-2 flex-1 rounded-full transition-colors",
              i <= idx ? "bg-primary" : "bg-secondary",
            )}
          />
        ))}
      </div>
```

- [ ] Also move the step label above the bar to mono/eyebrow styling to match the mockup (`Schritt 3 von 5`). Replace:

```tsx
      <p className="text-xs text-muted-foreground text-center mb-3">
        {t("stepLabel", { current: idx + 1, total })}
      </p>
```

with:

```tsx
      <p className="text-kiosk-label text-center mb-3">
        {t("stepLabel", { current: idx + 1, total })}
      </p>
```

Steps (wizard-step-footer):
- [ ] In `wizard-step-footer.tsx`, drop `variant="month"` from the continue button (default is now the accent). Replace:

```tsx
        <Button variant="month" onClick={goNext} disabled={disabled}>
          {nextLabel ?? t("continue")}
          <ArrowRight className="size-4 ml-2" />
        </Button>
```

with:

```tsx
        <Button onClick={goNext} disabled={disabled}>
          {nextLabel ?? t("continue")}
          <ArrowRight className="size-4 ml-2" />
        </Button>
```

Steps (calendar / homeassistant / weather — GlassCard → Card):
- [ ] In each of `setup/calendar/page.tsx`, `setup/homeassistant/page.tsx`, `setup/weather/page.tsx`: change the import `import { GlassCard } from "@/components/ui/card";` → `import { Card, CardContent } from "@/components/ui/card";`. Then change the wrapper `<GlassCard className="p-6 md:p-8">` → `<Card><CardContent className="p-6 md:p-8">` and its close `</GlassCard>` → `</CardContent></Card>`. (Each file has exactly one GlassCard.) No `month-primary` tokens exist in these three step bodies, so no further token swaps are needed there.

Steps (done page):
- [ ] In `setup/done/page.tsx`, flatten + tokenize + kiosk CTA. Replace the import:

```tsx
import { GlassCard } from "@/components/ui/card";
```

with:

```tsx
import { Card, CardContent } from "@/components/ui/card";
```

- [ ] Replace the body:

```tsx
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center size-20 rounded-2xl bg-month-primary/10 border border-month-primary/20 mb-4">
          <Sparkles className="size-10 text-month-primary" strokeWidth={1.5} />
        </div>
        <h1 className="text-3xl font-display tracking-tight">{t("title")}</h1>
      </div>
      <GlassCard className="p-6 md:p-8">
        <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>
        <Button variant="month" size="lg" className="w-full" asChild>
          <Link href="/">
            {t("cta")}
            <ArrowRight className="size-4 ml-2" />
          </Link>
        </Button>
      </GlassCard>
```

with:

```tsx
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center size-20 icon-badge rounded-3xl mb-4">
          <Sparkles className="size-10" strokeWidth={1.75} />
        </div>
        <h1 className="text-3xl font-display font-medium tracking-tight">{t("title")}</h1>
      </div>
      <Card>
        <CardContent className="p-6 md:p-8">
          <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>
          <Button size="kiosk" className="w-full" asChild>
            <Link href="/">
              {t("cta")}
              <ArrowRight className="size-4 ml-2" />
            </Link>
          </Button>
        </CardContent>
      </Card>
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `refactor(onboarding): flatten + tokenize setup shell and remaining steps`

---

### Task 6 — i18n keys + LocaleSwitcher aria + changelog

**Files**
- `webapp/src/components/locale-switcher.tsx` (edit)
- `webapp/messages/en.json` (edit)
- `webapp/messages/de.json` (edit)
- `webapp/messages/fr.json` (edit)
- `CHANGELOG.md` (edit)

**Interfaces**
- Consumes: nothing new. Produces: i18n keys for the welcome screen (`join.welcomeEyebrow/welcomeTitle/welcomeBody/welcomeCreateCta/welcomeJoinCta`), a `localeSwitcher.label` key, and (optional, additive) `personColor.<key>` labels (not wired into `PersonColorPicker` aria — those stay as token keys for now; documented). EN/DE/FR parity is a CI gate.

Steps:
- [ ] i18n the LocaleSwitcher aria-label. In `locale-switcher.tsx`, add `import { useTranslations } from "next-intl";` (alongside `useLocale`), add `const t = useTranslations("localeSwitcher");` inside the component, and replace `aria-label="Language"` with `aria-label={t("label")}`.
- [ ] Add to `webapp/messages/en.json` — inside the `"join"` object, after `"joinCodeHint"`, add the welcome keys:

```json
    "welcomeEyebrow": "Welcome to Kinboard",
    "welcomeTitle": "Your home, on one wall.",
    "welcomeBody": "Calendar, tasks, shopping list and smart home — shared for the whole family. Let's set yours up in two minutes.",
    "welcomeCreateCta": "Create a new family",
    "welcomeJoinCta": "Join a family",
```

- [ ] Add a top-level `"localeSwitcher"` object to `en.json` (place it adjacent to other small top-level namespaces, e.g. right before `"join"`):

```json
  "localeSwitcher": {
    "label": "Language"
  },
```

- [ ] Mirror BOTH additions into `webapp/messages/de.json` with German copy:

```json
  "localeSwitcher": {
    "label": "Sprache"
  },
```

and inside `de.json`'s `"join"` object:

```json
    "welcomeEyebrow": "Willkommen bei Kinboard",
    "welcomeTitle": "Euer Zuhause, an einer Wand.",
    "welcomeBody": "Kalender, Aufgaben, Einkaufsliste und Smart Home — geteilt für die ganze Familie. Lass uns in zwei Minuten eure Familie einrichten.",
    "welcomeCreateCta": "Neue Familie anlegen",
    "welcomeJoinCta": "Einer Familie beitreten",
```

- [ ] Mirror BOTH additions into `webapp/messages/fr.json` with French copy:

```json
  "localeSwitcher": {
    "label": "Langue"
  },
```

and inside `fr.json`'s `"join"` object:

```json
    "welcomeEyebrow": "Bienvenue sur Kinboard",
    "welcomeTitle": "Votre foyer, sur un seul mur.",
    "welcomeBody": "Calendrier, tâches, liste de courses et maison connectée — partagés pour toute la famille. Configurons la vôtre en deux minutes.",
    "welcomeCreateCta": "Créer une nouvelle famille",
    "welcomeJoinCta": "Rejoindre une famille",
```

- [ ] Verify the three `join` objects and the three `localeSwitcher` objects have identical key sets (CI parity gate). Grep each file for the five new `welcome*` keys + `localeSwitcher` to confirm presence in all three.
- [ ] Add to `CHANGELOG.md` under `[Unreleased]`:

```markdown
### Changed
- Onboarding redesign ("Salbei / Leinen"): `/join` now opens on a welcome screen (logo badge, eyebrow, big title, "Create a new family" / "Join a family" CTAs) and the setup wizard + join code entry use flat cards and the month accent instead of the old glass look.

### Added
- Join code is now entered in a six-cell input (paste, backspace-to-previous, and arrow-key navigation supported).
- Curated 10-color person palette with a swatch picker (selected swatch ringed) and a live avatar preview on the "Who's in your family?" setup step.
- Language switcher now has a localized accessible label (EN/DE/FR).
```

- [ ] Add a `### Known limitations` note under `[Unreleased]` (or a one-line note in the Changed entry) recording the deferrals:

```markdown
### Notes
- Onboarding redesign deferred two mockup elements with no functional backing: the on-screen numeric keypad on join-mobile (the join code is alphanumeric, so a numeric keypad can't enter it — the native keyboard handles the cells) and the kiosk "show this code" screen with an expiry countdown (`families.join_code` is a static value with no expiry column; a timer would be fake).
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(onboarding): welcome + locale-switcher i18n (EN/DE/FR) and changelog`

---

## Self-Review

**Scope item → task mapping**
1. Shared `PERSON_COLORS` constant + `PersonColorPicker` → **Task 1**.
2. `CodeInput` component → **Task 2**.
3. `/join` welcome + flat restyle (CodeInput adopted, GlassCard→Card, month-primary→primary, hooks preserved, keypad deferred) → **Task 3**.
4. `setup/people` restyle (PersonColorPicker, PersonAvatar, dashed add button, palette-seeded drafts, useCreatePerson preserved) → **Task 4**.
5. Setup shell + remaining steps sweep (layout bg, wizard-progress, wizard-step-footer, calendar/homeassistant/weather/done) → **Task 5**.
6. i18n + LocaleSwitcher aria + changelog (EN/DE/FR parity) → **Task 6**.

**Type-consistency check**
- `PersonColor = { key: string; hex: string }`; `PERSON_COLORS` typed `readonly PersonColor[]`. `PersonColorPicker` props `{ value: string; onChange: (hex: string) => void; className?: string }` — matches Task 4 usage `value={d.color} onChange={(hex) => updateDraft(d.id, { color: hex })}`.
- `CodeInput` props `{ value: string; onChange: (v: string) => void; length?: number; onComplete?: () => void; className?: string }` — Task 3 calls `<CodeInput value={joinCode} onChange={setJoinCode} length={6} />`; `setJoinCode` is `Dispatch<SetStateAction<string>>`, structurally assignable to `(v: string) => void`. ✓
- `useCreatePerson` accepts `{ name, color, avatar_url?, is_child? }`; Task 4 still passes `{ name, color }` only — unchanged, valid.
- `PersonAvatar` requires `{ name, color }`; Task 4 passes `name={d.name || "?"} color={d.color} size={44}` — valid (size is `number`).
- `Button` `size="kiosk"` exists (`h-16 px-6 text-base`); default variant is the month accent — removing `variant="month"` is correct, no `text-white` literals introduced (`text-primary-foreground` is baked into the default variant).
- `Card`/`CardContent` are exported from `@/components/ui/card`; `GlassCard` removed from all six edited surfaces.

**Token / constraint compliance**
- No hardcoded accent hex in className; person hex applied only via inline `style` (PersonColorPicker swatches, PersonAvatar, CodeInput uses tokenized borders). `--person-*` tokens already exist in `globals.css` (English names: coral/amber/citron/forest/teal/sky/indigo/lilac/berry/clay) — `PERSON_COLORS.key` values match those names.
- No `backdrop-blur`/glass introduced on join or setup surfaces. The `LocaleSwitcher`'s own pill keeps its existing `backdrop-blur` style (it is a small control chrome element, not an app content surface) — **documented decision**: left as-is to avoid touching a shared component used outside onboarding; only its aria-label is i18n'd.
- Lucide icons use `strokeWidth={1.75}`; code cells use `font-mono`.

**Flagged deferrals**
- **Numeric keypad (join-mobile)**: NOT built — join code is alphanumeric (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`); native keyboard serves the cells. Recorded in CHANGELOG `### Notes`.
- **Kiosk code-display + expiry timer**: NOT built — `families.join_code` is static, no expiry column; a countdown would be fake and the screen needs a DB migration (out of scope for a visual redesign). Recorded in CHANGELOG `### Notes`.
- **Color names i18n**: `personColor.<key>` translation labels are NOT wired into the picker's `aria-label` (which uses the stable token key) to keep the picker free of a `useTranslations` dependency and each task independently lint-clean. If localized swatch labels are wanted later, add the namespace ×3 and swap the `aria-label`. Documented in Task 1 / Task 6.
