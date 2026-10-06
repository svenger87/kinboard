"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Gift, Palette, PawPrint, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { CreatureLookEditor } from "@/components/pocket-money/creature-look-editor";
import { CelebrationOverlay } from "@/components/pocket-money/celebration-overlay";
import { StagesSheet } from "@/components/pocket-money/stages-sheet";
import { RewardsPanel } from "@/components/pocket-money/rewards-panel";
import { CreatureShop } from "@/components/pocket-money/creature-shop";
import { useCreatureMood } from "@/hooks/use-creature-mood";
import {
  usePeople,
  usePocketMoneyAccounts,
  usePointRewards,
  usePointRedemptions,
  usePointTotals,
  useOwnedItems,
  useCreatures,
  useUpdateCreature,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import { creatureStage } from "@/lib/creatures/stage";
import { creatureChildren, stageProgress } from "@/lib/creatures/surfaces";
import { pointsStageWrites } from "@/lib/pocket-money/points";
import { hasDrawnArt, readLook, type AvatarStyle, type CreatureLook } from "@/lib/pocket-money/creatures";
import type { StageUp } from "@/lib/pocket-money/creature-reactions";
import { formatCents } from "@/lib/pocket-money/format";
import type { Creature, Person, PocketMoneyAccount } from "@/types/database";

/**
 * Rewards (RFC-017 §4): each child's creature, large, and what their task
 * points buy. One child at a time, chosen at the top; `?child=<person id>`
 * opens a child's tab (the Creatures widget, a profile, a child's own device
 * at start -- lib/device-owner.ts).
 *
 * Only children with a creature switched on are here, and none of it needs a
 * pocket-money account: the points are the child's own (point_person_totals),
 * a reward request needs no PIN -- a parent decides it in Settings ->
 * Creatures & rewards -- and the creature grows with points unless a parent
 * set it to grow with the money in an account that exists.
 *
 * The page is the creature first, then the child's points and the rewards,
 * then the shop (RFC-017 §5), when a parent has left it on for this child.
 */
export default function RewardsPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("rewardsPage");
  const router = useRouter();
  const { data: people, isPending: peoplePending } = usePeople();
  const { data: creatures, isPending: creaturesPending, isError } = useCreatures();
  const children = creatureChildren(people, creatures);
  const [activeId, setActiveId] = useState<string | null>(null);

  // ?child=<person id>: read once from the address, as the pocket-money page
  // does, rather than with useSearchParams and a Suspense boundary around the
  // whole page.
  useEffect(() => {
    if (children.length === 0) return;
    const wanted = new URLSearchParams(window.location.search).get("child");
    if (wanted && children.some((c) => c.person.id === wanted)) setActiveId(wanted);
    // Once the children are known; a later change of the list keeps the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children.length]);

  if ((peoplePending || creaturesPending) && !isError) {
    return (
      <main id="main-content" className="p-8 max-w-2xl mx-auto space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-56" />
        <Skeleton className="h-32" />
      </main>
    );
  }

  if (children.length === 0) {
    return (
      <main id="main-content" className="p-6 max-w-2xl mx-auto space-y-6 safe-area-inset">
        <PageHeader title={t("title")} icon={Gift} />
        <EmptyState
          icon={PawPrint}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={{ label: t("emptyCta"), onClick: () => router.push("/settings/creatures") }}
        />
      </main>
    );
  }

  const active = children.find((c) => c.person.id === activeId) ?? children[0];

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-3xl space-y-6 p-6 safe-area-inset lg:max-w-5xl"
      data-testid="rewards-page"
      data-child={active.person.id}
    >
      <PageHeader
        title={t("title")}
        icon={Gift}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/creatures">{t("manage")}</Link>
          </Button>
        }
      />

      {children.length > 1 && (
        // The control is inline-flex and as wide as its names: with four or
        // more children on a phone it was wider than the screen and pushed
        // the whole page sideways. It scrolls inside this box instead.
        <div className="max-w-full overflow-x-auto" data-testid="child-chooser">
          <SegmentedControl value={active.person.id} onValueChange={setActiveId} aria-label={t("chooseChild")}>
            {children.map(({ person }) => (
              <SegmentedControlItem key={person.id} value={person.id}>
                {person.name}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      )}

      {/* Keyed by child: the sheets, the draft look and the celebration
          belong to one child and start over for the next. */}
      <ChildRewards key={active.person.id} person={active.person} creature={active.creature} />
    </main>
  );
}

type CelebrationKind = "evolution";

function ChildRewards({ person, creature }: { person: Person; creature: Creature }) {
  const t = useTranslations("rewardsPage");
  const tPM = useTranslations("pocketMoney");
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const account: PocketMoneyAccount | undefined = accounts.find((a) => a.person_id === person.id);
  const { ready: pointsReady, totalsFor } = usePointTotals();
  const { ready: ownedReady, ownedFor } = useOwnedItems();
  const owned = ownedFor(person.id);
  const { data: rewards = [] } = usePointRewards();
  const { data: redemptions = [] } = usePointRedemptions();
  const updateCreature = useUpdateCreature();
  const mood = useCreatureMood(person.id);

  const totals = totalsFor(person.id);
  const stage = creatureStage({ creature, account, earnedPoints: totals.earned });
  const pointsMode = stage.mode === "points";
  const species = creature.species;
  const style = creature.style ?? "classic";
  const look = readLook(creature.look, owned);
  const stageName = (tier: number) => tPM(`species.${species}.tier${tier}` as never);
  const currency = account?.currency ?? "EUR";

  const [lookOpen, setLookOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [celebration, setCelebration] = useState<CelebrationKind | null>(null);
  const [celebrationFrom, setCelebrationFrom] = useState(1);
  const [celebrationTo, setCelebrationTo] = useState<number | null>(null);
  // A stage-up reached by a tick arrives twice -- with the tick (the
  // creature's reaction) and once the points refetch (the effect below) --
  // and plays once, as on the pocket-money page.
  const lastCelebrated = useRef<{ to: number; at: number } | null>(null);

  const celebrateStage = useCallback((from: number, to: number) => {
    const last = lastCelebrated.current;
    if (last && last.to === to && Date.now() - last.at < 30_000) return;
    lastCelebrated.current = { to, at: Date.now() };
    setCelebrationFrom(from);
    setCelebrationTo(to);
    setCelebration("evolution");
  }, []);

  // Record the stage shown and celebrate a new one: the same rule as the
  // pocket-money page (pointsStageWrites), so the two pages agree on what was
  // seen. Waits for the points in points mode -- "not loaded yet" read as "no
  // points" would drop the stage and celebrate it coming back.
  useEffect(() => {
    if (pointsMode && !pointsReady) return;
    const { celebrate, update } = pointsStageWrites({
      stage,
      lastSeenTier: creature.last_seen_tier,
      storedBestTier: creature.best_tier,
    });
    if (celebrate) celebrateStage(creature.last_seen_tier ?? stage.tier - 1, stage.tier);
    if (Object.keys(update).length > 0) {
      updateCreature.mutateAsync({ personId: person.id, change: update }).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id, account?.balance_cents, stage.tier, pointsMode, pointsReady]);

  const handleCelebrationDone = useCallback(() => {
    setCelebration(null);
    setCelebrationTo(null);
  }, []);

  const progressValue = pointsMode ? totals.earned : (account?.balance_cents ?? 0);
  const progress = stageProgress(stage, progressValue);

  return (
    <>
      <section className="flex flex-col items-center text-center space-y-3" aria-labelledby="creature-heading" data-testid="rewards-creature">
        {look.name && (
          <p className="text-2xl font-bold leading-tight" data-testid="creature-name">
            {look.name}
          </p>
        )}
        <ReactingCreature
          personId={person.id}
          onStageUp={({ from, to }: StageUp) => celebrateStage(from, to)}
          species={species}
          tier={stage.tier}
          style={style}
          look={look}
          mood={mood}
          size={220}
          tappable
          label={stageName(stage.tier)}
          tapLabel={tPM("tapAvatarAria", { stage: stageName(stage.tier) })}
        />
        {hasDrawnArt(species) && (
          <Button
            variant="ghost"
            size="sm"
            // Waits for the purchases: the editor saves the whole look, and
            // one opened before they load would take worn items off.
            disabled={!ownedReady}
            onClick={() => setLookOpen(true)}
            className="text-muted-foreground"
            data-testid="change-look"
          >
            <Palette className="size-4 mr-1.5" />
            {tPM("changeLook")}
          </Button>
        )}
        <h2 id="creature-heading" className="text-lg font-semibold text-muted-foreground">
          {person.name}
        </h2>
        <button
          type="button"
          onClick={() => setStagesOpen(true)}
          className="flex w-full max-w-sm flex-col items-center gap-1.5 rounded-xl border border-border/70 px-4 py-2.5 transition hover:bg-white/[0.04] hover:border-border active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50"
          aria-label={tPM("stagesSheetOpenAria")}
          data-testid="stage-button"
        >
          <span className="text-xl font-bold flex items-center gap-2" data-testid="stage-name">
            {stageName(stage.tier)}
            {stage.best > stage.tier && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-500 dark:text-amber-300"
                title={tPM("bestStageTooltip")}
              >
                <Star className="size-3 fill-current" />
                {tPM("bestStageBadge", { stage: stageName(stage.best) })}
              </span>
            )}
          </span>
          <Progress
            value={progress}
            className="h-2 w-full"
            aria-label={t("stageProgressAria", { percent: progress })}
            data-testid="stage-progress"
          />
          <span className="text-sm font-medium text-muted-foreground">
            {stage.next === null
              ? tPM("maxStageHint")
              : pointsMode
                ? tPM("nextStageHintPoints", { stage: stageName(stage.next.tier), count: stage.next.at })
                : tPM("nextStageHint", { stage: stageName(stage.next.tier), amount: formatCents(stage.next.at, currency) })}
          </span>
        </button>
      </section>

      <RewardsPanel
        personId={person.id}
        totals={totals}
        rewards={rewards}
        redemptions={redemptions.filter((r) => r.person_id === person.id)}
      />

      {/* RFC-017 step 3: the shop, under the rewards, while a parent leaves
          it on. Turned off, it is gone; what was bought stays on. */}
      {/* It waits for the purchases (and the points), as Change look does:
          before they load every item would offer "Buy", an owned one too. */}
      {creature.shop_enabled && hasDrawnArt(species) && !(ownedReady && pointsReady) && (
        <Skeleton className="h-64 w-full" data-testid="creature-shop-loading" />
      )}
      {creature.shop_enabled && hasDrawnArt(species) && ownedReady && pointsReady && (
        <CreatureShop
          personId={person.id}
          name={look.name || person.name}
          species={species}
          tier={stage.tier}
          style={style}
          look={look}
          owned={owned}
          totals={totals}
        />
      )}

      <CelebrationOverlay
        kind={celebration}
        onDone={handleCelebrationDone}
        creature={{ species, style, look, from: celebrationFrom, to: celebrationTo ?? stage.tier }}
      />

      <Sheet open={lookOpen} onOpenChange={setLookOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{tPM("changeLookTitle")}</SheetTitle>
            <SheetDescription>{tPM("changeLookDescription")}</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {lookOpen && (
              <CreatureLookEditor
                species={species}
                tier={stage.tier}
                style={style}
                look={look}
                owned={owned}
                childName={person.name}
                saving={updateCreature.isPending}
                onCancel={() => setLookOpen(false)}
                onSave={({ style: nextStyle, look: nextLook }: { style: AvatarStyle; look: CreatureLook }) =>
                  updateCreature
                    .mutateAsync({ personId: person.id, change: { style: nextStyle, look: nextLook } })
                    .then(() => setLookOpen(false))
                    .catch(() => toast.error(tPM("avatarStyleSaveFailed")))
                }
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <StagesSheet
        open={stagesOpen}
        onOpenChange={setStagesOpen}
        species={species}
        avatarStyle={style}
        look={look}
        stage={stage}
        currency={currency}
        mood={mood}
      />
    </>
  );
}
