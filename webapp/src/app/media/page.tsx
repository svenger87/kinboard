"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Music } from "lucide-react";
import { useFamilyStore } from "@/stores/family-store";
import { useMediaPlayers } from "@/hooks/use-media-players";
import { useMediaPlayerStates } from "@/hooks/use-media-player-state";
import { PlayerCard } from "@/components/media/player-card";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export default function MediaPage() {
  const t = useTranslations("media");
  const { family } = useFamilyStore();
  const { data: players = [] } = useMediaPlayers();
  const states = useMediaPlayerStates(players);

  return (
    <main id="main-content" className="min-h-page p-4 md:p-6 lg:p-8">
      <PageHeader icon={Music} title={t("title")} className="mb-4" />
      {players.length === 0 ? (
        <Card className="p-6">
          <p className="font-medium">{t("noPlayers")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("noPlayersHint")}</p>
          <Link href="/settings/media-players" className="mt-3 inline-block text-sm underline">
            {t("addPlayer")}
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {family &&
            players.map((p) => (
              <PlayerCard key={p.id} player={p} state={states[p.id]} familyId={family.id} />
            ))}
        </div>
      )}
    </main>
  );
}
