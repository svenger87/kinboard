"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveShopPrices, useShopPricesSetting } from "@/hooks/use-point-rewards";
import {
  MAX_PRICE,
  MIN_PRICE,
  SHOP_SLOTS,
  isPrice,
  itemsIn,
  priceOf,
  type ShopItem,
  type ShopPrices,
} from "@/lib/pocket-money/creatures/shop";

/**
 * Settings -> Creatures -> Shop prices: what each item in the creature shop
 * costs this family, in task points. Saved on leaving a field, like the
 * rewards' costs, through PUT /api/creatures/shop-prices (settings PIN). An
 * item changed shows its standard price beside it; one button puts every item
 * back. A purchase keeps the price it was bought for.
 */
export function ShopPricesSettings() {
  const t = useTranslations("settings.creatures");
  const tShop = useTranslations("shop");
  const { prices, ready } = useShopPricesSetting();
  const save = useSaveShopPrices();
  // Locked until the family's prices are in, and while one change is saving:
  // each save is the whole list, built on what is shown.
  const locked = !ready || save.isPending;
  const changed = Object.keys(prices).length > 0;

  const failed = (err: unknown) =>
    toast.error(err instanceof Error && err.message === "pin_required" ? t("errorPinRequired") : t("errorGeneric"));

  const commit = (item: ShopItem, field: HTMLInputElement) => {
    const now = priceOf(item, prices);
    const raw = field.value.trim();
    // Emptied: back to the standard price.
    const next = raw === "" ? item.cost : Number(raw);
    if (!isPrice(next)) {
      field.value = String(now);
      toast.error(t("pricesInvalid", { min: MIN_PRICE, max: MAX_PRICE }));
      return;
    }
    if (next === now) {
      field.value = String(now);
      return;
    }
    const list: Record<string, number> = { ...prices, [item.id]: next };
    if (next === item.cost) delete list[item.id];
    save.mutateAsync(list as ShopPrices).catch((err: unknown) => {
      field.value = String(now);
      failed(err);
    });
  };

  return (
    <Card id="prices" data-setting="prices" className="p-4 space-y-4" data-testid="shop-prices">
      <div className="space-y-1">
        <Label className="text-base">{t("pricesLabel")}</Label>
        <p className="text-sm text-muted-foreground">{t("pricesHint")}</p>
      </div>
      {SHOP_SLOTS.map((slot) => (
        <div key={slot} className="space-y-2">
          <h3 className="text-sm font-medium">{tShop(`slots.${slot}` as never)}</h3>
          <ul className="space-y-2">
            {itemsIn(slot)
              .filter((item) => !item.retired)
              .map((item) => {
                const name = tShop(`items.${item.id}` as never);
                const price = priceOf(item, prices);
                return (
                  <li key={item.id} className="flex items-center gap-3">
                    <label htmlFor={`price-${item.id}`} className="min-w-0 flex-1 text-sm">
                      {name}
                    </label>
                    {price !== item.cost && (
                      <span className="text-xs text-muted-foreground" data-testid={`price-standard-${item.id}`}>
                        {t("pricesStandard", { count: item.cost })}
                      </span>
                    )}
                    <Input
                      // A new key when the stored price changes, so the field shows it.
                      key={`${item.id}:${price}`}
                      id={`price-${item.id}`}
                      aria-label={t("priceAria", { item: name })}
                      className="w-24 text-right tabular-nums"
                      type="number"
                      inputMode="numeric"
                      min={MIN_PRICE}
                      max={MAX_PRICE}
                      step={1}
                      defaultValue={price}
                      disabled={locked}
                      onBlur={(e) => commit(item, e.target)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      {changed && (
        <Button variant="outline" size="sm" disabled={locked} onClick={() => save.mutateAsync({}).catch(failed)}>
          {t("pricesReset")}
        </Button>
      )}
    </Card>
  );
}
