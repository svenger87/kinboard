"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Check, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WidgetCard } from "@/components/widget-card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFamilyStore } from "@/stores/family-store";
import {
  useMessages,
  useSendMessage,
  useAcknowledgeMessage,
  useTakeoverMessage,
} from "@/hooks/use-messages";

const MAX_BODY = 200;

export function MessagesWidget() {
  const t = useTranslations("messages");
  const { device } = useFamilyStore();
  const { data: messages = [] } = useMessages();
  const takeover = useTakeoverMessage();
  const send = useSendMessage();
  const acknowledge = useAcknowledgeMessage();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  // The one currently holding the board is not also a row down here. It is
  // still the same message, and showing it twice for its first minute would
  // read as two. Your own message has no takeover, so it appears here at once
  // — which is the whole difference between sending and being told.
  const waiting = messages.filter((m) => m.id !== takeover?.id);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await send.mutateAsync(body);
      setDraft("");
      setOpen(false);
    } catch {
      toast.error(t("sendFailed"));
    }
  };

  return (
    <WidgetCard title={t("title")} icon={MessageSquare}>
      <div className="flex flex-col gap-3">
        {waiting.map((message) => {
          // Your own message offers "Withdraw", not "Got it". Acknowledging
          // your own would mean the feature could be satisfied without anybody
          // in the house having seen anything — and it is also the only way a
          // one-device household can ever end a message. RFC-005 §5.
          const mine = message.sender_device_id === (device?.id ?? null);
          return (
            <div
              key={message.id}
              // The guard has to find the row that holds a given message and
              // then the button in it. Walking up from the text with `..` lands
              // on the inner text wrapper, whose sibling the button is — so the
              // row says what it is instead.
              data-message-row
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{message.body}</p>
                {mine && (
                  <p className="truncate text-xs text-muted-foreground">{t("waiting")}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                aria-label={mine ? t("withdraw") : t("gotIt")}
                onClick={() => acknowledge.mutate(message.id)}
              >
                {mine ? <Undo2 className="size-4" /> : <Check className="size-4" />}
              </Button>
            </div>
          );
        })}

        {waiting.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="min-h-[44px]">
              {t("compose")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("compose")}</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              value={draft}
              maxLength={MAX_BODY}
              placeholder={t("placeholder")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("remaining", { count: MAX_BODY - draft.length })}
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={() => void submit()} disabled={!draft.trim() || send.isPending}>
                {t("send")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </WidgetCard>
  );
}
