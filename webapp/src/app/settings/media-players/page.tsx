"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Music } from "lucide-react";
import { useHomeAssistantEntities } from "@/hooks/use-home-assistant";
import {
  useMediaPlayers,
  useSaveMediaPlayer,
  useDeleteMediaPlayer,
} from "@/hooks/use-media-players";
import { entityIdOf } from "@/hooks/use-media-player-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export default function MediaPlayersSettingsPage() {
  const t = useTranslations("media");
  const { data: players = [] } = useMediaPlayers();
  const { data: entities = [] } = useHomeAssistantEntities("media_player");
  const save = useSaveMediaPlayer();
  const remove = useDeleteMediaPlayer();
  const [picked, setPicked] = useState("");

  // entityIdOf comes from Task 6 — the same reader the state hook uses, so the
  // two cannot disagree about where a row's entity id lives.
  const alreadyAdded = new Set(players.map(entityIdOf));
  const available = entities.filter((e) => !alreadyAdded.has(e.entity_id));

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader icon={Music} title={t("settingsTitle")} subtitle={t("settingsDescription")} />

        <Card className="p-6">
          <ul className="mb-6 flex flex-col gap-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-border bg-background/50 px-4 py-3"
              >
                <span>{p.nickname}</span>
                <Button
                  variant="ghost"
                  className="min-h-[44px] text-destructive"
                  onClick={() => remove.mutate(p.id)}
                >
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-h-[44px] rounded-lg border border-border bg-background px-2"
              aria-label={t("pickEntity")}
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
            >
              <option value="">{t("pickEntity")}</option>
              {available.map((e) => (
                <option key={e.entity_id} value={e.entity_id}>
                  {String(e.attributes?.friendly_name ?? e.entity_id)}
                </option>
              ))}
            </select>
            <Button
              className="min-h-[44px]"
              disabled={!picked || save.isPending}
              onClick={() => {
                const entity = entities.find((e) => e.entity_id === picked);
                save.mutate({
                  driver: "home_assistant",
                  nickname: String(entity?.attributes?.friendly_name ?? picked),
                  position: players.length,
                  config: { entity_id: picked },
                });
                setPicked("");
              }}
            >
              {t("addPlayer")}
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
