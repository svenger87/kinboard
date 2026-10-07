"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Gift, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useDecideRedemption,
  useDeleteReward,
  usePointRedemptions,
  usePointRewards,
  useSaveReward,
} from "@/hooks/use-point-rewards";
import { RewardIcon } from "@/components/pocket-money/rewards-panel";
import { REWARD_COST_MAX, REWARD_COST_MIN, REWARD_TITLE_MAX } from "@/lib/pocket-money/points";
import { EmojiIconField } from "@/components/emoji-picker";
import type { PointReward } from "@/types/database";

/** Server codes turned into something a parent can act on. */
function errorText(err: unknown, t: (key: string) => string): string {
  const code = err instanceof Error ? err.message : String(err);
  if (code === "pin_required") return t("errorPinRequired");
  if (code === "already_decided") return t("errorAlreadyDecided");
  if (code === "insufficient_points") return t("errorInsufficientPoints");
  if (code === "no_creature") return t("errorNoCreature");
  return t("errorGeneric");
}

/**
 * Requests for rewards waiting on a parent, every child's, shown like the
 * withdrawal requests: one row each, approve or deny. The route checks the
 * settings PIN; an approval the points no longer cover is refused and the
 * request stays.
 */
export function RedemptionInbox({
  nameOf,
}: {
  nameOf: (personId: string) => string;
}) {
  const t = useTranslations("settings.pocketMoney");
  const { data: redemptions = [] } = usePointRedemptions();
  const decide = useDecideRedemption();
  const pending = redemptions.filter((r) => r.status === "pending");

  // The anchor is always there, empty or not: a push about a request links to
  // #inbox (lib/notifications/rewards.ts), and by the time someone taps it
  // another parent may have answered. The link then lands on "nothing
  // waiting" rather than on the top of the page with no explanation.
  if (pending.length === 0) {
    return (
      <div id="inbox" data-setting="inbox" className="scroll-mt-20">
        <p className="px-1 text-sm text-muted-foreground" data-testid="redemption-inbox-empty">
          {t("redemptionInboxEmpty")}
        </p>
      </div>
    );
  }

  return (
    <Card id="inbox" data-setting="inbox" className="p-4 space-y-2 scroll-mt-20" data-testid="redemption-inbox">
      <h3 className="font-semibold">{t("redemptionInboxTitle")}</h3>
      {pending.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <RewardIcon icon={r.icon} className="text-lg" />
            <span className="truncate">
              {t("redemptionRow", { name: nameOf(r.person_id), title: r.title, count: r.cost_points })}
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              // One decision at a time per request: a double tap must not
              // send a second approval while the first is on its way.
              disabled={decide.isPending && decide.variables?.id === r.id}
              onClick={() =>
                decide
                  .mutateAsync({ id: r.id, status: "approved" })
                  .catch((err) => toast.error(errorText(err, t)))
              }
            >
              {t("approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending && decide.variables?.id === r.id}
              onClick={() =>
                decide
                  .mutateAsync({ id: r.id, status: "denied" })
                  .catch((err) => toast.error(errorText(err, t)))
              }
            >
              {t("deny")}
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function costOf(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= REWARD_COST_MIN && n <= REWARD_COST_MAX ? n : null;
}

/** One reward in the catalogue, edited in place; saved when a field is left. */
function RewardRow({ reward }: { reward: PointReward }) {
  const t = useTranslations("settings.pocketMoney");
  const save = useSaveReward();
  const del = useDeleteReward();
  const fail = (err: unknown) => toast.error(errorText(err, t));
  const patch = (draft: Parameters<typeof save.mutateAsync>[0]["draft"]) =>
    save.mutateAsync({ id: reward.id, draft }).catch(fail);

  return (
    <li className="grid grid-cols-[3.5rem_1fr_5.5rem] items-center gap-2 sm:grid-cols-[3.5rem_1fr_6rem_auto_auto]" data-testid="reward-row">
      <EmojiIconField
        value={reward.icon}
        label={t("rewardIconLabel")}
        className="w-full"
        onChange={(icon) => {
          if (icon !== reward.icon) patch({ icon });
        }}
      />
      <Input
        aria-label={t("rewardTitleLabel")}
        defaultValue={reward.title}
        maxLength={REWARD_TITLE_MAX}
        onBlur={(e) => {
          const title = e.target.value.trim();
          if (!title) {
            e.target.value = reward.title;
            return;
          }
          if (title !== reward.title) patch({ title });
        }}
      />
      <Input
        aria-label={t("rewardCostLabel")}
        type="number"
        inputMode="numeric"
        min={REWARD_COST_MIN}
        max={REWARD_COST_MAX}
        step={1}
        defaultValue={reward.cost_points}
        onBlur={(e) => {
          const cost = costOf(e.target.value);
          if (cost === null) {
            e.target.value = String(reward.cost_points);
            toast.error(t("rewardCostInvalid", { min: REWARD_COST_MIN, max: REWARD_COST_MAX }));
            return;
          }
          if (cost !== reward.cost_points) patch({ cost_points: cost });
        }}
      />
      <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-1">
        <Switch
          checked={reward.active}
          onCheckedChange={(active) => patch({ active })}
          aria-label={t("rewardActiveAria", { title: reward.title })}
        />
        {t("rewardActiveLabel")}
      </label>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("rewardDeleteAria", { title: reward.title })}
        onClick={() => del.mutateAsync(reward.id).catch(fail)}
        disabled={del.isPending}
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </li>
  );
}

/**
 * The family's rewards catalogue: what children with a creature can spend
 * their task points on. Kept under Settings -> Creatures & rewards (RFC-017),
 * behind the settings PIN.
 */
export function RewardCatalogue() {
  const t = useTranslations("settings.pocketMoney");
  const { data: rewards = [] } = usePointRewards();
  const save = useSaveReward();
  const [icon, setIcon] = useState("");
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState("");

  const parsedCost = costOf(cost);
  const canAdd = title.trim().length > 0 && parsedCost !== null && !save.isPending;

  const add = () => {
    if (!canAdd || parsedCost === null) return;
    save
      .mutateAsync({ draft: { title: title.trim(), cost_points: parsedCost, icon: icon.trim() || null, active: true } })
      .then(() => {
        setIcon("");
        setTitle("");
        setCost("");
      })
      .catch((err) => toast.error(errorText(err, t)));
  };

  return (
    <Card id="rewards" data-setting="rewards" className="p-4 space-y-3" data-testid="reward-catalogue">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <Gift className="size-4" />
          {t("rewardsTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("rewardsDescription")}</p>
      </div>

      {rewards.length > 0 && (
        <ul className="space-y-2">
          {rewards.map((reward) => (
            // Keyed on the saved values so a change from another screen
            // resets these uncontrolled inputs.
            <RewardRow key={`${reward.id}-${reward.updated_at}`} reward={reward} />
          ))}
        </ul>
      )}

      <form
        className="grid grid-cols-[3.5rem_1fr_5.5rem] items-end gap-2 border-t border-border pt-3 sm:grid-cols-[3.5rem_1fr_6rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="new-reward-icon" className="text-xs">{t("rewardIconLabel")}</Label>
          <EmojiIconField
            id="new-reward-icon"
            value={icon || null}
            label={t("rewardIconLabel")}
            className="w-full"
            onChange={(next) => setIcon(next ?? "")}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-reward-title" className="text-xs">{t("rewardTitleLabel")}</Label>
          <Input
            id="new-reward-title"
            value={title}
            maxLength={REWARD_TITLE_MAX}
            placeholder={t("rewardTitlePlaceholder")}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-reward-cost" className="text-xs">{t("rewardCostLabel")}</Label>
          <Input
            id="new-reward-cost"
            type="number"
            inputMode="numeric"
            min={REWARD_COST_MIN}
            max={REWARD_COST_MAX}
            step={1}
            value={cost}
            placeholder="100"
            onChange={(e) => setCost(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!canAdd} className="col-span-3 sm:col-span-1">
          <Plus className="size-4 mr-1" />
          {t("rewardAdd")}
        </Button>
      </form>
    </Card>
  );
}
