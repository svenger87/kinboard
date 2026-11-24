"use client";

import { useTranslations } from "next-intl";
import { Check, MessageSquare, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposeMessage, useWaitingMessages } from "@/components/widgets/messages-widget";
import { CountBadge, HOME_ROW_BUTTON, HomeEmptyLine, HomeList, TARGET_SQ } from "./list-shared";
import type { HomeWidgetProps } from "./shared";
import { HomeCard } from "./frame";

type Message = ReturnType<typeof useWaitingMessages>["waiting"][number];

const keyOf = (m: Message) => m.id;

/**
 * The messages waiting on this screen, as many as fit, each ended in one tap
 * ("Got it", or "Withdraw" for your own), as on the card. "+" writes one in
 * the card's dialog, over the layout. Messages have no page of their own, so
 * the title is not a link and "+n" is a count.
 */
export function MessagesHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("messages");
  const { waiting, isMine, acknowledge } = useWaitingMessages();

  const renderItem = (message: Message) => {
    const mine = isMine(message);
    return (
      <>
        <div data-message-row className={HOME_ROW_BUTTON}>
          <div className="min-w-0 flex-1 py-[0.3em]">
            <p className="break-words home-body leading-snug">{message.body}</p>
            {message.sender_label && (
              <p data-message-sender className="break-words home-meta text-muted-foreground">
                {t("via", { label: message.sender_label })}
              </p>
            )}
            {mine && <p className="home-meta text-muted-foreground">{t("waiting")}</p>}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={TARGET_SQ}
            aria-label={mine ? t("withdraw") : t("gotIt")}
            onClick={() => acknowledge(message.id)}
          >
            {mine ? <Undo2 className="size-[0.9em]" /> : <Check className="size-[0.9em]" />}
          </Button>
        </div>
      </>
    );
  };

  return (
    <HomeCard list
      testId="home-widget-messages"
      icon={MessageSquare}
      title={t("title")}
      badge={<CountBadge count={waiting.length} />}
      editing={editing}
      right={
        <ComposeMessage
          trigger={
            <Button variant="ghost" size="icon" className={TARGET_SQ} aria-label={t("compose")}>
              <Plus className="size-[1em] text-muted-foreground" />
            </Button>
          }
        />
      }
    >
      <HomeList items={waiting} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("empty")} />} />
    </HomeCard>
  );
}
