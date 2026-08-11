"use client";

import { Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { useContextRules, useSetRuleEnabled } from "@/hooks/use-attention";
import { RULES } from "@/lib/attention/rules";

/**
 * Which hints the board is allowed to give.
 *
 * This page exists because turning a hint off from the hint itself — which the
 * plan requires, and which is the right place to do it — is otherwise a
 * **one-way door**. The moment it is switched off the hint stops appearing, so
 * the only control that could bring it back has gone with it. A family that
 * dismissed something in a hurry could never undo it.
 *
 * The rules are listed from the shipped set rather than from the database, so
 * a rule a family has never touched still appears, switched on. Absence of a
 * row means enabled, and a list built from the rows would show nothing at all
 * to the family that has never opened this page.
 */
export default function HintsSettingsPage() {
  const t = useTranslations("settings.hints");
  const { data: rules } = useContextRules();
  const setEnabled = useSetRuleEnabled();

  const disabled = new Set(
    (rules ?? []).filter((r) => r.enabled === false).map((r) => r.rule_id)
  );

  return (
    // The same shell every other settings page uses. Without it this page had
    // no top padding, so the floating back button sat on top of the title and
    // cut off the subtitle behind it; the cards ran the full width of a
    // desktop panel instead of the centred column, and the last rule row
    // disappeared under the navigation bar. 25 of the 28 settings pages
    // already open exactly like this — the page was simply missing it.
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <PageHeader
          icon={Lightbulb}
          title={t("title")}
          subtitle={t("description")}
          className="mb-8"
        />

        <Card className="divide-y">
        {RULES.map((rule) => {
          const isOn = !disabled.has(rule.id);
          return (
            <div key={rule.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                {/* Translated, falling back to the rule's own English wording.
                    A German household should not read English rule names in an
                    otherwise German interface — and the fallback means a rule
                    added tomorrow still shows something sensible rather than a
                    missing-key placeholder. */}
                <p className="font-medium">{t.has(`rules.${rule.id}.title`) ? t(`rules.${rule.id}.title`) : rule.title}</p>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {t.has(`rules.${rule.id}.description`)
                    ? t(`rules.${rule.id}.description`)
                    : rule.description}
                </p>
                <p className="text-muted-foreground/70 mt-1 text-xs">
                  <code>{rule.id}</code>
                </p>
              </div>
              <Switch
                checked={isOn}
                aria-label={rule.title}
                onCheckedChange={(next) =>
                  setEnabled.mutate({ ruleId: rule.id, enabled: next })
                }
              />
            </div>
          );
        })}
        </Card>
      </div>
    </main>
  );
}
