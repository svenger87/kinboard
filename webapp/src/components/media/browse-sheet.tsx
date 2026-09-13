"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { BrowseNode } from "@/plugins/media/types";
import type { MediaPlayer } from "@/types/database";

/** One step of where we are, so Back is a step rather than a reload. */
interface Crumb {
  id?: string;
  type?: string;
  title: string;
}

/**
 * Pick something to play (RFC-003 M3).
 *
 * Until this existed Kinboard could only control what was already playing —
 * somebody had to start it from the speaker's own app first. One level is
 * fetched at a time, because Home Assistant returns a level at a time and a
 * household with a large library should not wait for a tree nobody asked for.
 *
 * Artwork goes through the player's artwork proxy: `thumbnail` is a path on
 * the Home Assistant host that needs the access token, which the browser does
 * not have and must not be given.
 */
export function MediaBrowseSheet({
  player,
  familyId,
  open,
  onOpenChange,
  onPlay,
}: {
  player: MediaPlayer;
  familyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlay: (node: BrowseNode) => void;
}) {
  const t = useTranslations("media");
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [nodes, setNodes] = useState<BrowseNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const here = trail[trail.length - 1];

  const load = useCallback(
    async (crumb: Crumb | undefined) => {
      setLoading(true);
      setFailed(false);
      try {
        const qs = new URLSearchParams({ family_id: familyId });
        if (crumb?.id) qs.set("media_content_id", crumb.id);
        if (crumb?.type) qs.set("media_content_type", crumb.type);
        const res = await fetch(`/api/media-players/${player.id}/browse?${qs}`);
        if (!res.ok) {
          setFailed(true);
          setNodes([]);
          return;
        }
        setNodes(((await res.json()) as { nodes: BrowseNode[] }).nodes ?? []);
      } catch {
        setFailed(true);
        setNodes([]);
      } finally {
        setLoading(false);
      }
    },
    [familyId, player.id],
  );

  // Start at the player's own root each time it opens, rather than wherever
  // somebody left off — a wall panel is used by whoever walks up to it.
  useEffect(() => {
    if (!open) return;
    setTrail([]);
    void load(undefined);
  }, [open, load]);

  const openNode = (node: BrowseNode) => {
    const crumb = { id: node.id, type: node.type, title: node.title };
    setTrail((prev) => [...prev, crumb]);
    void load(crumb);
  };

  const goBack = () => {
    const next = trail.slice(0, -1);
    setTrail(next);
    void load(next[next.length - 1]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{here?.title ?? t("browseTitle", { name: player.nickname })}</SheetTitle>
          <SheetDescription>{player.nickname}</SheetDescription>
        </SheetHeader>

        {trail.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2 min-h-[44px]" onClick={goBack}>
            <ChevronLeft className="mr-1 size-4" />
            {t("browseBack")}
          </Button>
        )}

        {loading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("browseLoading")}
          </p>
        )}

        {/* Three outcomes, told apart: could not read it, read it and it is
            empty, and here it is. An unreachable speaker and an empty folder
            look the same otherwise. */}
        {!loading && failed && <p className="py-6 text-sm">{t("browseFailed")}</p>}
        {!loading && !failed && nodes.length === 0 && (
          <p className="py-6 text-sm text-muted-foreground">{t("browseEmpty")}</p>
        )}

        {!loading && !failed && nodes.length > 0 && (
          <ul className="mt-2 flex flex-col">
            {nodes.map((node) => (
              <li key={`${node.type}:${node.id}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => (node.expandable ? openNode(node) : onPlay(node))}
                >
                  {node.artworkUrl ? (
                    <img
                      src={`/api/media-players/${player.id}/artwork?family_id=${familyId}&src=${encodeURIComponent(node.artworkUrl)}`}
                      alt=""
                      className="size-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="size-10 shrink-0 rounded bg-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{node.title}</span>
                  {node.expandable ? (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Play className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
