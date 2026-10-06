/**
 * Pushes about rewards (RFC-017): a child asked for one, and a parent
 * answered.
 *
 *   reward_requested  to the parents' phones -- "Mia would like 🎮 An hour of
 *                     Minecraft (50 ⭐)" -- opening the inbox in Settings →
 *                     Creatures & rewards. Queued whoever asked: the child's
 *                     own screen, Home Assistant, an assistant.
 *   reward_decided    to the child's own device, the one whose "Belongs to"
 *                     is that child (Settings → Devices), when there is one --
 *                     opening their Rewards page.
 *
 * Both go through scheduled_notifications, so the processor
 * (api/cron/process-notifications) applies each device's quiet hours and its
 * "Rewards" switch exactly as for every other push.
 *
 * WHO "THE PARENTS" ARE. Kinboard has no parent devices as such: the
 * approvals that already push (an assistant's pocket-money booking, a door
 * unlock) go to every phone of the family, because a parent is whoever can
 * type the settings PIN. The same rule here, with one refinement that "Belongs
 * to" now makes possible: a device that belongs to a child is not a parent's,
 * so a brother's tablet is not told what his sister asked for. Devices that
 * belong to nobody, or to a grown-up, are asked, as for every approval; a
 * kiosk is not -- it is the family's wall screen, not anyone's phone.
 *
 * WHAT A PUSH CARRIES. The child's name and the reward's title, icon and cost
 * -- never anything of the creature: not its look, not the name the child
 * gave it (e2e/creature-look.spec.ts holds this file to it).
 */

import type { RedemptionRow } from "@/lib/pocket-money/rewards";
import { rewardsHref } from "@/lib/device-owner";

export const REWARD_REQUESTED = "reward_requested";
export const REWARD_DECIDED = "reward_decided";

/** The notification_preferences column that switches both off for a device. */
export const REWARD_PREFERENCE_COLUMN = "reward_requests";

/** Where a parent answers: the inbox at the top of Settings → Creatures & rewards. */
export const REWARD_INBOX_URL = "/settings/creatures#inbox";

// The admin client is untyped for these tables, as in the routes.
type Db = any;

export interface QueuedPush {
  family_id: string;
  notification_type: string;
  scheduled_for: string;
  title: string;
  body: string | null;
  data: Record<string, string>;
  related_entity_type: string;
  related_entity_id: string;
}

/** The row a request queues. `childName` is the person's name, nothing of the creature. */
export function rewardRequestedRow(
  redemption: Pick<RedemptionRow, "id" | "family_id" | "person_id" | "title" | "icon" | "cost_points">,
  childName: string,
  sourceDeviceId: string | null,
  now: Date,
): QueuedPush {
  return {
    family_id: redemption.family_id,
    notification_type: REWARD_REQUESTED,
    scheduled_for: now.toISOString(),
    // The column is NOT NULL; the processor writes the real, localised text.
    title: "Reward request",
    body: null,
    data: {
      redemption_id: redemption.id,
      person_id: redemption.person_id,
      child_name: childName,
      reward_title: redemption.title,
      reward_icon: redemption.icon ?? "",
      cost_points: String(redemption.cost_points),
      // The device that asked is not told about its own request.
      ...(sourceDeviceId ? { source_device_id: sourceDeviceId } : {}),
    },
    related_entity_type: "point_redemption",
    related_entity_id: redemption.id,
  };
}

/** The row a decision queues, addressed to the child (`target_person_id`). */
export function rewardDecidedRow(
  redemption: Pick<RedemptionRow, "id" | "family_id" | "person_id" | "title" | "icon" | "cost_points">,
  status: "approved" | "denied",
  now: Date,
): QueuedPush {
  return {
    family_id: redemption.family_id,
    notification_type: REWARD_DECIDED,
    scheduled_for: now.toISOString(),
    title: status === "approved" ? "Reward approved" : "Reward declined",
    body: null,
    data: {
      redemption_id: redemption.id,
      target_person_id: redemption.person_id,
      status,
      reward_title: redemption.title,
      reward_icon: redemption.icon ?? "",
      cost_points: String(redemption.cost_points),
    },
    related_entity_type: "point_redemption",
    related_entity_id: redemption.id,
  };
}

/**
 * The live notifier for lib/pocket-money/rewards.ts. Never throws: a push
 * that cannot be queued is logged, and the request or decision stands.
 */
export function liveRewardNotifier(db: Db, now: () => Date = () => new Date()) {
  return {
    async requested(redemption: RedemptionRow, sourceDeviceId: string | null) {
      try {
        const { data: person, error: personError } = await db
          .from("people").select("name").eq("id", redemption.person_id).eq("family_id", redemption.family_id).maybeSingle();
        if (personError) throw new Error(personError.message);
        const { error } = await db.from("scheduled_notifications")
          .insert(rewardRequestedRow(redemption, person?.name ?? "", sourceDeviceId, now()));
        if (error) throw new Error(error.message);
      } catch (err) {
        console.error("[rewards] could not queue the request's push:", err);
      }
    },
    async decided(familyId: string, redemptionId: string, status: "approved" | "denied") {
      try {
        const { data: redemption, error: readError } = await db
          .from("point_redemptions").select("id, family_id, person_id, title, icon, cost_points")
          .eq("id", redemptionId).eq("family_id", familyId).maybeSingle();
        if (readError) throw new Error(readError.message);
        if (!redemption) return;
        const { error } = await db.from("scheduled_notifications").insert(rewardDecidedRow(redemption, status, now()));
        if (error) throw new Error(error.message);
      } catch (err) {
        console.error("[rewards] could not queue the decision's push:", err);
      }
    },
  };
}

// ── who receives it ─────────────────────────────────────────────────────────

export type Audience =
  | { kind: "everyone" }
  /** Every device but kiosks and those that belong to a child. */
  | { kind: "parents" }
  /** Only the non-kiosk devices that belong to this person. */
  | { kind: "owner"; personId: string };

export function audienceFor(type: string, data: Record<string, string> | null | undefined): Audience {
  if (type === REWARD_REQUESTED) return { kind: "parents" };
  if (type === REWARD_DECIDED) {
    // A decision with no child to address goes to nobody, never to everyone.
    return { kind: "owner", personId: data?.target_person_id ?? "" };
  }
  return { kind: "everyone" };
}

/**
 * The processor batches a family's queue by type into one push per batch.
 * Decisions for two children are two pushes to two devices, so their
 * addressee is part of the key.
 */
export function batchKey(n: { family_id: string; notification_type: string; data?: Record<string, string> | null }): string {
  const audience = audienceFor(n.notification_type, n.data);
  return `${n.family_id}::${n.notification_type}${audience.kind === "owner" ? `::${audience.personId}` : ""}`;
}

export interface DeviceOwnerRow { id: string; person_id: string | null; is_kiosk: boolean | null }

/** The subscriptions an audience reaches. `childIds`: the family's children. */
export function filterAudience<S extends { device_id: string }>(
  subscriptions: readonly S[],
  audience: Audience,
  devices: readonly DeviceOwnerRow[],
  childIds: ReadonlySet<string>,
): S[] {
  if (audience.kind === "everyone") return [...subscriptions];
  const byId = new Map(devices.map((d) => [d.id, d]));
  if (audience.kind === "parents") {
    return subscriptions.filter((s) => {
      const device = byId.get(s.device_id);
      // A kiosk is the family's wall screen, which shows the request anyway
      // (the Rewards badge) and has no parent holding it.
      if (device?.is_kiosk) return false;
      const owner = device?.person_id;
      return !(owner && childIds.has(owner));
    });
  }
  return subscriptions.filter((s) => {
    const device = byId.get(s.device_id);
    return !!audience.personId && !!device && !device.is_kiosk && device.person_id === audience.personId;
  });
}

// ── what it says ────────────────────────────────────────────────────────────

type PushT = (key: string, values?: Record<string, string | number>) => string;

interface QueuedRow { id: string; related_entity_id: string | null; data: Record<string, string> | null }

/** "🎮 An hour of Minecraft", or the title alone. */
export function rewardLabel(data: Record<string, string> | null | undefined): string {
  const title = data?.reward_title ?? "";
  const icon = data?.reward_icon ?? "";
  return icon ? `${icon} ${title}` : title;
}

/** The push for a batch of one type and one audience. */
export function rewardPushPayload(
  type: typeof REWARD_REQUESTED | typeof REWARD_DECIDED,
  rows: readonly QueuedRow[],
  t: PushT,
): { title: string; body: string; tag: string; url: string } {
  const list = (labels: string[]) => labels.length <= 3
    ? labels.join(", ")
    : `${labels.slice(0, 3).join(", ")} ${t("moreSuffix", { count: labels.length - 3 })}`;

  if (type === REWARD_REQUESTED) {
    if (rows.length === 1) {
      const d = rows[0].data ?? {};
      return {
        title: t("rewardRequestedTitle", { name: d.child_name ?? "", reward: rewardLabel(d), cost: Number(d.cost_points ?? 0) }),
        body: t("rewardRequestedBody"),
        tag: `reward-request-${rows[0].related_entity_id ?? rows[0].id}`,
        url: REWARD_INBOX_URL,
      };
    }
    return {
      title: t("rewardRequestedMany", { count: rows.length }),
      body: list(rows.map((r) => `${r.data?.child_name ?? ""}: ${rewardLabel(r.data)}`)),
      tag: "reward-requests",
      url: REWARD_INBOX_URL,
    };
  }

  const child = rows[0].data?.target_person_id ?? "";
  const url = child ? rewardsHref(child) : "/rewards";
  if (rows.length === 1) {
    const d = rows[0].data ?? {};
    const approved = d.status === "approved";
    return {
      title: approved ? t("rewardApprovedTitle", { reward: rewardLabel(d) }) : t("rewardDeniedTitle", { reward: rewardLabel(d) }),
      body: approved ? t("rewardApprovedBody") : t("rewardDeniedBody", { cost: Number(d.cost_points ?? 0) }),
      tag: `reward-${rows[0].related_entity_id ?? rows[0].id}`,
      url,
    };
  }
  return {
    title: t("rewardDecidedMany", { count: rows.length }),
    body: list(rows.map((r) => `${r.data?.status === "approved" ? "✓" : "✗"} ${rewardLabel(r.data)}`)),
    tag: `reward-answers-${child}`,
    url,
  };
}
