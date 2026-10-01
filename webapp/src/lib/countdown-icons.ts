/**
 * The countdown widget's icon choices, in its order; the first is its
 * default. Their own module, free of server imports, because the widget is
 * a client component and the Integration API (lib/countdowns.ts) refuses
 * any other icon from an assistant.
 */
export const COUNTDOWN_ICONS = ["🎉", "🎄", "🎂", "🏖️", "🎒", "🚗", "⭐"] as const;
export type CountdownIcon = (typeof COUNTDOWN_ICONS)[number];
export const DEFAULT_COUNTDOWN_ICON: CountdownIcon = COUNTDOWN_ICONS[0];
