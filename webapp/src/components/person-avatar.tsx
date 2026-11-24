import { cn } from "@/lib/utils";
import { personOn } from "@/lib/person-color";

export interface PersonAvatarProps {
  name: string;
  color: string;
  avatarUrl?: string | null;
  /**
   * Diameter in px. 24 inline · 40 default · 40-48 lists · 64 kiosk. Or a CSS
   * length ("1.6em") for an avatar that follows the text size around it.
   */
  size?: number | string;
  /** Card-colored 2-3px border for overlapping stacks / contrast. */
  ring?: boolean;
  className?: string;
}

function isImageAvatar(avatar?: string | null): boolean {
  return !!avatar && (avatar.startsWith("http") || avatar.startsWith("data:"));
}

function isEmojiAvatar(avatar?: string | null): boolean {
  return !!avatar && !avatar.startsWith("http") && !avatar.startsWith("data:");
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function PersonAvatar({
  name,
  color,
  avatarUrl,
  size = 40,
  ring = false,
  className,
}: PersonAvatarProps) {
  const ringWidth = typeof size === "number" && size >= 56 ? 3 : 2;
  const scaled = (factor: number) =>
    typeof size === "number" ? Math.round(size * factor) : `calc(${size} * ${factor})`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold select-none",
        ring && "ring-[var(--pa-ring-w)] ring-card",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        // Was a hard-coded text-white, which measured 2.15:1 on the seeded
        // amber and fails for every colour in the curated palette (KB-09).
        color: personOn(color),
        // A length in em is the parent's em: set on this element it would be
        // read against its own font size, and the circle would come out
        // 2.4 times too large. The letter gets its size on a span inside.
        fontSize: typeof size === "number" ? scaled(0.42) : undefined,
        ["--pa-ring-w" as string]: `${ringWidth}px`,
      }}
      aria-label={name}
      role="img"
    >
      {isImageAvatar(avatarUrl) ? (
        <img src={avatarUrl as string} alt={name} className="h-full w-full object-cover" />
      ) : isEmojiAvatar(avatarUrl) ? (
        <span style={{ fontSize: scaled(0.55) }}>{avatarUrl}</span>
      ) : typeof size === "number" ? (
        initial(name)
      ) : (
        <span style={{ fontSize: scaled(0.42) }}>{initial(name)}</span>
      )}
    </span>
  );
}
