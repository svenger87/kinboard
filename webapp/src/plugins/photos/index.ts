import { Images } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { usePhotoLibraryCount } from "@/hooks/use-photo-library-count";
import { PhotosWidget } from "@/components/widgets/photos-widget";

/**
 * The photo album viewer.
 *
 * Kinboard could already *show* photos — on the idle screen, one at a time,
 * with no way to go back to the one you just missed. This is the surface for
 * looking on purpose: a grid you can scroll and open.
 *
 * It has no source of its own. It reads whatever `photo_source` is set to, so
 * connecting Immich, a DLNA server or an iCloud shared album lights up the
 * screensaver and the viewer together rather than asking twice.
 */
export const photosPlugin: SurfacePlugin = {
  id: "photos",
  navItem: {
    href: "/photos",
    icon: Images,
    labelKey: "photos",
  },
  settingsItem: {
    href: "/settings/photos",
    icon: Images,
    titleKey: "title",
    descriptionKey: "description",
  },
  // Hidden until there is a library behind it: a nav entry that opens an
  // empty screen is worse than no nav entry, and this one is only useful
  // once a source is connected.
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  dashboardWidget: PhotosWidget,
  useOwnDataCount: usePhotoLibraryCount,
  i18nNamespace: "photosViewer",
};
