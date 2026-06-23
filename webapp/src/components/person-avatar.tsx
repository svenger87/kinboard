import { cn } from "@/lib/utils";

export interface PersonAvatarProps {
  name: string;
  color: string;
  avatarUrl?: string | null;
  /** Diameter in px. 24 inline · 40 default · 40-48 lists · 64 kiosk. */
  size?: number;
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
  const ringWidth = size >= 56 ? 3 : 2;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white select-none",
        ring && "ring-[var(--pa-ring-w)] ring-card",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: Math.round(size * 0.42),
        ["--pa-ring-w" as string]: `${ringWidth}px`,
      }}
      aria-label={name}
      role="img"
    >
      {isImageAvatar(avatarUrl) ? (
        <img src={avatarUrl as string} alt={name} className="h-full w-full object-cover" />
      ) : isEmojiAvatar(avatarUrl) ? (
        <span style={{ fontSize: Math.round(size * 0.55) }}>{avatarUrl}</span>
      ) : (
        initial(name)
      )}
    </span>
  );
}
