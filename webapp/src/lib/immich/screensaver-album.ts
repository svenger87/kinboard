import { albumMatchesMonth } from "@/lib/month-names";

/**
 * The Immich album the screensaver shows.
 *
 * Settings → Photos offers "Album for screensaver": an album picked by name,
 * or Automatic, which means this month's "Wallpaper <month>" album. The
 * screensaver used to look only for the Wallpaper album and never read the
 * choice at all, so a picked album showed nothing unless a Wallpaper album
 * for the month also happened to exist (#536). The dashboard widget, which
 * lets the server read the setting, showed the picked album all along.
 */
export function screensaverAlbumId(
  selectedAlbum: string | undefined | null,
  albums: { id: string; name: string }[] | undefined,
  now: Date = new Date(),
): string | undefined {
  if (selectedAlbum) return selectedAlbum;
  return albums?.find(
    (album) => album.name.toLowerCase().includes("wallpaper") && albumMatchesMonth(album.name, now),
  )?.id;
}
