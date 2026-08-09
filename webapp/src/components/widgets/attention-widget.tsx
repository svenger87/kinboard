"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Clock, Info, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useAcknowledgeAttention,
  useAttentionItems,
  useDismissAttention,
  useSetRuleEnabled,
  useSnoozeAttention,
  type AttentionItem,
} from "@/hooks/use-attention";

/**
 * What the family needs to know right now.
 *
 * Three rules govern how this behaves, all from the plan:
 *
 * 1. **It stays quiet.** An empty board renders nothing at all — no "0 items",
 *    no empty state. A panel that is always present becomes wallpaper, and
 *    then the one morning it matters nobody looks at it.
 * 2. **Every hint explains itself.** Tapping the ⓘ shows why this is on
 *    screen, from the evidence the rule recorded, without asking anything.
 * 3. **Every hint can be switched off from itself.** Not via a settings page
 *    somebody has to go and find while holding a schoolbag.
 */

const SNOOZE_MINUTES = 60;

function evidenceLines(item: AttentionItem): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(item.evidence ?? {})) {
    if (value === null || value === undefined) continue;
    const rendered = Array.isArray(value) ? value.join(", ") : String(value);
    if (!rendered) continue;
    lines.push(`${key.replace(/_/g, " ")}: ${rendered}`);
  }
  return lines;
}

export function AttentionWidget() {
  const { data: items } = useAttentionItems();
  const acknowledge = useAcknowledgeAttention();
  const snooze = useSnoozeAttention();
  const dismiss = useDismissAttention();
  const setRuleEnabled = useSetRuleEnabled();
  const [explaining, setExplaining] = useState<string | null>(null);
  const t = useTranslations("attention");

  // Acknowledged, snoozed and dismissed items stay in the table — the
  // evaluator needs them to know it has already been answered — but they are
  // not what the family still has to deal with, so they are not shown.
  const open = (items ?? []).filter((i) => i.state === "active");
  if (open.length === 0) return null;

  return (
    <Card className="col-span-full border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
      <CardContent className="space-y-3 p-4">
        {open.map((item) => {
          const lines = evidenceLines(item);
          const isExplaining = explaining === item.id;

          return (
            <div key={item.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{item.title}</p>
                  {item.detail && (
                    <p className="text-muted-foreground mt-0.5 text-sm">{item.detail}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-8">
                {/* Sized for a thumb on a wall tablet, not a mouse. */}
                <Button
                  size="sm"
                  variant="default"
                  className="h-9"
                  onClick={() => acknowledge.mutate(item.id)}
                >
                  <Check className="mr-1 size-4" /> {t("ok")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={() => snooze.mutate({ id: item.id, minutes: SNOOZE_MINUTES })}
                >
                  <Clock className="mr-1 size-4" /> {t("later")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={() => setExplaining(isExplaining ? null : item.id)}
                  aria-expanded={isExplaining}
                >
                  <Info className="mr-1 size-4" /> {t("why")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground h-9"
                  onClick={() => dismiss.mutate(item.id)}
                >
                  <X className="size-4" />
                  <span className="sr-only">{t("dismiss")}</span>
                </Button>
              </div>

              {isExplaining && (
                <div className="bg-background/70 ml-8 rounded-md border p-3 text-sm">
                  <p className="text-muted-foreground">
                    {t("rule")} <code className="text-foreground">{item.rule_id}</code>
                  </p>
                  {lines.length > 0 && (
                    <ul className="text-muted-foreground mt-2 space-y-0.5">
                      {lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {/* The plan's requirement, literally: disableable from the
                      hint itself. Anything else means finding a settings page
                      while holding a schoolbag. */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 h-9"
                    onClick={() => {
                      setRuleEnabled.mutate({ ruleId: item.rule_id, enabled: false });
                      setExplaining(null);
                    }}
                  >
                    {t("disableRule")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
