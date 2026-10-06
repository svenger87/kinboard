"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { useBuyItem } from "@/hooks/use-point-rewards";
import { useUpdateCreature } from "@/hooks/use-creatures";
import { CreatureAvatar } from "./creature-avatar";
import {
  SHOP_SLOTS,
  effectiveStyle,
  hasClassicArt,
  isDrawnStyle,
  itemsIn,
  type AvatarStyle,
  type CreatureLook,
  type DrawnStyle,
  type ShopItem,
  type ShopSlot,
} from "@/lib/pocket-money/creatures";
import type { AvatarTier } from "@/lib/pocket-money/types";
import type { PointTotals } from "@/lib/pocket-money/points";

/**
 * The shop (RFC-017 §5): things a child buys for their creature with task
 * points -- something for the head, glasses, something round the neck and a
 * background. On /rewards, under the rewards, for a child whose shop a parent
 * has left on.
 *
 * Buying needs no PIN (the child's own action) and spends at once; the
 * database checks the balance, holding pending reward requests, under the
 * child's lock. Each card shows the child's own creature with the item on.
 * An item bought is the child's: "Wear" puts it in its slot of the look,
 * "Take off" empties the slot, and Change look offers it too.
 */
export function CreatureShop({
  personId,
  name,
  species,
  tier,
  style,
  look,
  owned,
  totals,
}: {
  personId: string;
  /** The creature's name, or the child's. */
  name: string;
  species: string;
  tier: AvatarTier;
  style: AvatarStyle | string;
  /** The look as drawn: only owned items in it (readLook with `owned`). */
  look: CreatureLook;
  owned: ReadonlySet<string>;
  totals: PointTotals;
}) {
  const t = useTranslations("shop");
  const tCommon = useTranslations("common");
  const buy = useBuyItem();
  const update = useUpdateCreature();
  const [confirming, setConfirming] = useState<ShopItem | null>(null);
  const uid = useId();
  // At least 44px tall on a touch screen, for a child's finger.
  const touch = "w-full [@media(pointer:coarse)]:h-11";

  // The previews: a drawn style (a classic picture cannot show an item), and
  // a creature grown far enough that the item reads at card size, so an
  // egg's owner still sees what a hat looks like.
  const shown = effectiveStyle(species, style);
  const previewStyle: DrawnStyle = isDrawnStyle(shown) ? shown : "gumdrop";
  const previewTier = Math.max(tier, 5) as AvatarTier;
  const itemName = (item: ShopItem) => t(`items.${item.id}` as never);

  // The look and style as they are NOW. "Wear it" in the toast after a
  // purchase can be tapped seconds later, after other changes (another item
  // put on or taken off, here or on another screen): it must build on the
  // current look, not the one the purchase started from, or it would put
  // back what was taken off since.
  const latest = useRef({ look, shown });
  useEffect(() => {
    latest.current = { look, shown };
  });

  /** Put an item on, or take a slot's item off (id undefined), on the current look. */
  const wear = (slot: ShopSlot, id: string | undefined) => {
    const { look, shown } = latest.current;
    const next: CreatureLook = { ...look };
    if (id) next[slot] = id;
    else delete next[slot];
    // A classic picture shows nothing worn: putting something on moves the
    // creature to its drawing, as the first change in Change look does.
    const change: { look: CreatureLook; style?: AvatarStyle } = { look: next };
    if (id && shown === "classic" && hasClassicArt(species)) change.style = "gumdrop";
    update.mutateAsync({ personId, change }).catch(() => toast.error(t("errorWear")));
  };

  const purchase = (item: ShopItem) => {
    buy
      .mutateAsync({ personId, itemId: item.id })
      .then(() =>
        toast.success(t("bought", { item: itemName(item) }), {
          // Long enough for a child to read it and decide.
          duration: 10_000,
          action: { label: t("wearNow"), onClick: () => wear(item.slot, item.id) },
        }),
      )
      .catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "";
        toast.error(
          code === "insufficient_points" ? t("errorNotEnough")
          : code === "already_owned" ? t("errorOwned")
          : code === "shop_off" ? t("errorShopOff")
          : t("errorGeneric"),
        );
      });
  };

  return (
    <section className="w-full space-y-4" aria-labelledby="shop-heading" data-testid="creature-shop">
      <div className="space-y-1">
        <h2 id="shop-heading" className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingBag className="size-5 text-month-primary" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("intro", { name })}</p>
        {tier === 1 && <p className="text-xs text-muted-foreground" data-testid="shop-egg-hint">{t("eggHint", { name })}</p>}
      </div>

      {SHOP_SLOTS.map((slot) => {
        const items = itemsIn(slot).filter((i) => !i.retired || owned.has(i.id));
        const background = slot === "background";
        return (
          <div key={slot} className="space-y-2" data-testid={`shop-slot-${slot}`}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`slots.${slot}` as never)}</h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((item) => {
                const mine = owned.has(item.id);
                const worn = look[slot] === item.id;
                const affordable = totals.available >= item.cost;
                return (
                  <li key={item.id}>
                    <Card
                      className={`flex h-full flex-col items-center gap-2 p-3 text-center ${worn ? "border-month-primary" : ""}`}
                      data-testid={`shop-item-${item.id}`}
                      data-owned={mine}
                      data-worn={worn}
                    >
                      <CreatureAvatar
                        species={species}
                        tier={previewTier}
                        style={previewStyle}
                        look={{ ...look, [slot]: item.id }}
                        size={112}
                        animated={false}
                        label={t("previewAria", { name, item: itemName(item) })}
                      />
                      <p className="font-semibold leading-tight">{itemName(item)}</p>
                      {mine ? (
                        <p className="flex items-center gap-1 text-xs font-medium text-success">
                          <Check className="size-3.5" aria-hidden="true" />
                          {worn ? t(background ? "inUse" : "wearing") : t("owned")}
                        </p>
                      ) : (
                        <p className="text-sm font-semibold tabular-nums text-month-primary">
                          <span aria-hidden="true">⭐ </span>
                          {t("price", { count: item.cost })}
                        </p>
                      )}
                      <div className="mt-auto w-full">
                        {mine ? (
                          <Button
                            size="sm"
                            variant={worn ? "outline" : "default"}
                            className={touch}
                            disabled={update.isPending}
                            onClick={() => wear(slot, worn ? undefined : item.id)}
                            aria-label={t(
                              worn
                                ? background ? "removeBackgroundAria" : "takeOffAria"
                                : background ? "useBackgroundAria" : "wearAria",
                              { item: itemName(item) },
                            )}
                            data-testid="shop-wear"
                          >
                            {worn ? t(background ? "removeBackground" : "takeOff") : t(background ? "useBackground" : "wear")}
                          </Button>
                        ) : (
                          <>
                            {/* Not affordable: still focusable (aria-disabled, not
                                disabled), so a screen reader reaches it and reads
                                why, from the line below it. */}
                            <Button
                              size="sm"
                              className={`${touch} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
                              disabled={buy.isPending}
                              aria-disabled={!affordable || undefined}
                              onClick={() => affordable && setConfirming(item)}
                              aria-label={t("buyAria", { item: itemName(item), count: item.cost })}
                              aria-describedby={affordable ? undefined : `${uid}-${item.id}-missing`}
                              data-testid="shop-buy"
                            >
                              {t("buy")}
                            </Button>
                            {!affordable && (
                              <p id={`${uid}-${item.id}-missing`} className="mt-1 text-xs text-muted-foreground">
                                {t("missing", { count: item.cost - totals.available })}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming ? t("confirmTitle", { item: itemName(confirming) }) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDescription", { count: confirming?.cost ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="shop-confirm"
              onClick={() => {
                if (confirming) purchase(confirming);
                setConfirming(null);
              }}
            >
              {t("buy")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
