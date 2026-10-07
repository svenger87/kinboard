"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import {
  activeCreatureOf,
  useCreatures,
  useCurrency,
  usePeople,
  usePocketMoneyAccounts,
  usePointTotals,
  usePointPurchases,
  useOwnedItems,
  useRefundPurchase,
  useSwitchOnCreature,
  useUpdateCreature,
  type CreatureChange,
} from "@/hooks";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { RedemptionInbox, RewardCatalogue } from "@/components/pocket-money/rewards-settings";
import { CreatureAvatar, type CreatureAvatarProps } from "@/components/pocket-money/creature-avatar";
import { useCreatureMood } from "@/hooks/use-creature-mood";
import { ChangeCreatureSheet } from "@/components/pocket-money/change-creature-sheet";
import { AvatarStylePicker } from "@/components/pocket-money/avatar-style-picker";
import { SpeciesPicker } from "@/components/pocket-money/species-picker";
import { readLook, shopItem } from "@/lib/pocket-money/creatures";
import { creatureStage } from "@/lib/creatures/stage";
import { moneyAvailable, type GrowsWith } from "@/lib/creatures/rules";
import type { Creature, Person, PocketMoneyAccount, PointPurchase } from "@/types/database";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Settings -> Creatures & rewards (RFC-017). A child's creature, switched on
 * by a parent, and the family's rewards: no longer part of pocket money. Like
 * every settings page it sits behind the settings PIN (settings/layout.tsx),
 * and the routes check the PIN again on the server.
 */

/** A server code turned into something a parent can act on. */
function errorText(err: unknown, t: (key: string) => string): string {
  const code = err instanceof Error ? err.message : String(err);
  if (code === "pin_required") return t("errorPinRequired");
  if (code === "money_unavailable") return t("errorMoneyUnavailable");
  return t("errorGeneric");
}

/** The currency's name in the page's language: "Euro" for EUR. */
function useCurrencyName(currency: string): string {
  const locale = useLocale();
  return useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ?? currency;
    } catch {
      return currency;
    }
  }, [locale, currency]);
}

export default function CreaturesSettingsPage() {
  const t = useTranslations("settings.creatures");
  const { data: people = [] } = usePeople();
  const { data: creatures = [] } = useCreatures();
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const pocketMoneyOn = useIsPluginEnabled("pocket-money");
  const kids = people.filter((p) => p.is_child);
  const nameOf = (personId: string) => people.find((p) => p.id === personId)?.name ?? "";

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-3xl mx-auto space-y-6">
        <PageHeader title={t("title")} icon={Sparkles} />
        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        <RedemptionInbox nameOf={nameOf} />

        <div id="children" data-setting="children" className="space-y-3">
          {kids.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">{t("noKidsHint")}</Card>
          ) : (
            kids.map((kid) => (
              <ChildCreatureCard
                key={kid.id}
                kid={kid}
                creature={creatures.find((c) => c.person_id === kid.id)}
                account={accounts.find((a) => a.person_id === kid.id)}
                pocketMoneyOn={pocketMoneyOn}
              />
            ))
          )}
        </div>

        <RewardCatalogue />
      </div>
    </main>
  );
}

function ChildCreatureCard({
  kid,
  creature,
  account,
  pocketMoneyOn,
}: {
  kid: Person;
  creature: Creature | undefined;
  account: PocketMoneyAccount | undefined;
  pocketMoneyOn: boolean;
}) {
  const t = useTranslations("settings.creatures");
  const tPM = useTranslations("pocketMoney");
  const tPMS = useTranslations("settings.pocketMoney");
  const { currency } = useCurrency();
  const currencyName = useCurrencyName(account?.currency ?? currency);
  const switchOn = useSwitchOnCreature();
  const update = useUpdateCreature();
  const { totalsFor } = usePointTotals();
  const { ownedFor } = useOwnedItems();
  const { data: allPurchases = [] } = usePointPurchases();
  const purchases = allPurchases.filter((p) => p.person_id === kid.id);
  const refund = useRefundPurchase();
  const [refunding, setRefunding] = useState<PointPurchase | null>(null);
  const itemName = (id: string) => (shopItem(id) ? tShop(`items.${id}` as never) : id);
  const tShop = useTranslations("shop");
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const [changing, setChanging] = useState(false);
  // A child who never had a creature picks one first; one switched off comes
  // back as it was.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const on = Boolean(activeCreatureOf(creature ? [creature] : [], kid.id));
  const busy = switchOn.isPending || update.isPending;
  const canMoney = moneyAvailable({ pocketMoneyOn, hasAccount: Boolean(account) });
  const fail = (err: unknown) => toast.error(errorText(err, t));
  const change = (c: CreatureChange) =>
    update.mutateAsync({ personId: kid.id, change: c }).then(() => true).catch((err) => {
      fail(err);
      return false;
    });

  const toggle = (next: boolean) => {
    if (next && !creature) setPicking(true);
    else if (next) switchOn.mutateAsync({ personId: kid.id }).catch(fail);
    else change({ enabled: false });
  };
  const create = () => {
    if (!picked) return;
    switchOn
      .mutateAsync({ personId: kid.id, species: picked })
      .then(() => setPicking(false))
      .catch(fail);
  };

  const tier = creature
    ? creatureStage({ creature, account, earnedPoints: totalsFor(kid.id).earned }).tier
    : 1;
  const look = readLook(creature?.look, ownedFor(kid.id));
  const growsWith: GrowsWith = creature?.grows_with === "money" ? "money" : "points";

  return (
    <Card className="p-4 space-y-3" data-testid={`creature-card-${kid.id}`}>
      <div className="flex items-center gap-3">
        {creature && on && (
          <ChildCreature
            personId={kid.id}
            species={creature.species}
            tier={tier}
            style={creature.style}
            look={look}
            size={48}
            animated={false}
            label=""
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{kid.name}</p>
          <p className="text-xs text-muted-foreground" data-testid="creature-current">
            {creature && on ? tPM(`species.${creature.species}.label` as never) : t("off")}
          </p>
          {creature && on && (
            <p className="text-xs text-muted-foreground tabular-nums" data-testid="creature-points-summary">
              {tPMS("pointsSummary", { balance: totalsFor(kid.id).balance, earned: totalsFor(kid.id).earned })}
            </p>
          )}
        </div>
        <Switch
          checked={on || picking}
          disabled={busy}
          onCheckedChange={toggle}
          aria-label={t("switchAria", { name: kid.name })}
          data-testid="creature-switch"
        />
      </div>

      {picking && !creature && (
        <div className="pt-3 border-t border-border space-y-3" data-testid="creature-pick">
          <p className="text-xs text-muted-foreground">{t("pickHint")}</p>
          <SpeciesPicker picked={picked} onPick={setPicked} />
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!picked || busy} onClick={create} data-testid="creature-create">
              {picked ? t("switchOnAs", { species: tPM(`species.${picked}.label` as never) }) : t("switchOn")}
            </Button>
            <Button variant="outline" onClick={() => setPicking(false)}>
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      {creature && on && (
        <>
          <div className="pt-3 border-t border-border flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Label>{t("speciesLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("speciesHint")}</p>
            </div>
            <Button size="sm" variant="outline" data-testid="change-creature" onClick={() => setChanging(true)}>
              {t("changeSpecies")}
            </Button>
          </div>

          <div className="pt-3 border-t border-border space-y-1">
            <Label htmlFor={`grows-with-${kid.id}`}>{t("growsWithLabel")}</Label>
            <Select
              value={growsWith}
              onValueChange={(v) => change({ grows_with: v as GrowsWith })}
              disabled={busy}
            >
              <SelectTrigger
                id={`grows-with-${kid.id}`}
                className="w-full sm:w-64"
                aria-label={t("growsWithAria", { name: kid.name })}
                data-testid="grows-with"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="points">{t("growsWithPoints")}</SelectItem>
                {/* Saved money only with pocket money on and an account for
                    this child; a creature already on it keeps the option. */}
                {(canMoney || growsWith === "money") && (
                  <SelectItem value="money" disabled={!canMoney}>
                    {t("growsWithMoney", { currency: currencyName })}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {growsWith === "money" ? t("growsWithMoneyHint") : t("growsWithPointsHint")}
              {!canMoney && growsWith === "points" ? ` ${t("growsWithMoneyUnavailable")}` : ""}
            </p>
          </div>

          <div className="pt-3 border-t border-border flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor={`shop-${kid.id}`}>{t("shopLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("shopHint")}</p>
            </div>
            <Switch
              id={`shop-${kid.id}`}
              checked={creature.shop_enabled}
              disabled={busy}
              onCheckedChange={(shop) => change({ shop_enabled: shop })}
              data-testid="shop-switch"
            />
          </div>

          {/* What the child bought, newest first: a parent sees it whether
              the shop is on or off. */}
          <div className="space-y-1" data-testid={`purchases-${kid.id}`}>
            <p className="text-xs font-semibold text-muted-foreground">{t("purchasesLabel")}</p>
            {purchases.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("purchasesEmpty")}</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {purchases.map((p) => (
                  <li key={p.id} className="flex items-center gap-2" data-testid="purchase-row" data-item={p.item_id}>
                    <span className="min-w-0 flex-1 truncate">{itemName(p.item_id)}</span>
                    <span className="tabular-nums text-muted-foreground">⭐ {t("purchaseCost", { count: p.cost })}</span>
                    <time dateTime={p.created_at} className="tabular-nums text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}
                    </time>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs [@media(pointer:coarse)]:h-11"
                      disabled={refund.isPending}
                      onClick={() => setRefunding(p)}
                      aria-label={t("refundAria", { item: itemName(p.item_id) })}
                      data-testid="purchase-refund"
                    >
                      {t("refund")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <AlertDialog open={refunding !== null} onOpenChange={(open) => !open && setRefunding(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("refundConfirmTitle", { item: refunding ? itemName(refunding.item_id) : "" })}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("refundConfirmDescription", { name: kid.name, count: refunding?.cost ?? 0 })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="purchase-refund-confirm"
                    onClick={() => {
                      const p = refunding;
                      setRefunding(null);
                      if (!p) return;
                      refund
                        .mutateAsync(p.id)
                        .then(() => toast.success(t("refundDone", { item: itemName(p.item_id), count: p.cost })))
                        .catch(fail);
                    }}
                  >
                    {t("refund")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* How it is drawn: the child can change it on their own page too,
              so it takes no PIN. */}
          <div className="pt-3 border-t border-border space-y-1" data-testid={`avatar-style-${kid.id}`}>
            <Label>{tPM("avatarStyleLabel")}</Label>
            <p className="text-xs text-muted-foreground">{tPM("avatarStyleHint", { name: kid.name })}</p>
            <AvatarStylePicker
              species={creature.species}
              tier={tier}
              value={creature.style}
              look={look}
              childName={kid.name}
              disabled={busy}
              onChange={(style) => change({ style })}
            />
          </div>

          {changing && (
            <ChangeCreatureSheet
              open
              onOpenChange={(o) => !o && setChanging(false)}
              childName={kid.name}
              current={creature.species}
              avatarStyle={creature.style}
              look={look}
              saving={update.isPending}
              // Only the species: the stage, the style and the look stay.
              onSave={(species) => change({ species })}
            />
          )}
        </>
      )}
    </Card>
  );
}

/** The child's creature as it is now, mood and all (lib/creature-mood.ts). */
function ChildCreature({ personId, ...avatar }: CreatureAvatarProps & { personId: string }) {
  const mood = useCreatureMood(personId);
  return <CreatureAvatar {...avatar} mood={mood} />;
}
