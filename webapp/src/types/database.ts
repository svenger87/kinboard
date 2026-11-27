/**
 * The database's types, for the PostgREST client (`@/lib/db/postgrest`)
 * and everything that names a row.
 *
 * The columns, tables, relationships and functions come from
 * `./database.generated.ts`, which `npm run db:generate` writes from the
 * schema that init.sql and every migration build (RFC-024 §4.6 step 4), and
 * which CI regenerates and compares on every pull request. Until 1.17 this
 * file was written by hand, and had drifted: 17 tables and 16 columns the
 * database has were missing from it, so queries against them typed as
 * anything at all.
 *
 * What is still written here is only what a schema cannot say:
 *
 * - `ColumnTypes`: the shape of a few `jsonb` columns, which the database
 *   only knows as JSON. Each names a real column; a name the generated
 *   types don't have is a compile error (`_ColumnTypesNameRealColumns`).
 * - `NoWrites`: tables the app only reads, typed so a write doesn't compile.
 * - the row aliases below, and a few joined shapes.
 *
 * Text columns whose CHECK constraint lists their values (`status`,
 * `kind`, …) come out of the generator as those literals already.
 */
import type { Database as Generated, Json } from "./database.generated";
import type { DeviceScreen } from "@/lib/device-screen";
import type { HomeLayoutItem, LayoutItem } from "@/lib/layouts/types";

export type { Json };

type GeneratedTables = Generated["public"]["Tables"];

/** What `todo_events.detail` holds (migrations/066_todo_turns.sql). */
export interface TodoEventDetail {
  title?: string;
  source?: "device" | "integration" | "server";
  fields?: string[];
}

/** `jsonb` columns retyped, per table: the same type in Row, Insert and Update. */
type ColumnTypes = {
  /** Written only by POST /api/screen. */
  devices: { screen: DeviceScreen };
  layouts: { home: HomeLayoutItem[]; screensaver: LayoutItem[] };
  todo_events: { detail: TodoEventDetail };
};

/** Tables the app never writes, and which of their writes. */
type NoWrites = {
  todo_events: "Insert" | "Update";
  point_purchases: "Update";
};

/** Every table and column `ColumnTypes` names exists, or this is not `true`. */
type StrayColumns = {
  [T in keyof ColumnTypes]: T extends keyof GeneratedTables
    ? Exclude<keyof ColumnTypes[T], keyof GeneratedTables[T]["Row"]>
    : T;
}[keyof ColumnTypes];
type Expect<T extends true> = T;
export type _ColumnTypesNameRealColumns = Expect<[StrayColumns] extends [never] ? true : false>;

/** Retype `Over`'s columns of `Cols`, keeping each column's `?` and its `| null`. */
type Retype<Cols, Over> = {
  [K in keyof Cols]: K extends keyof Over ? (null extends Cols[K] ? Over[K] | null : Over[K]) : Cols[K];
};

type Part<T extends keyof GeneratedTables, P extends "Row" | "Insert" | "Update"> =
  T extends keyof NoWrites
    ? P extends NoWrites[T]
      ? { [key: string]: never }
      : Retype<GeneratedTables[T][P], T extends keyof ColumnTypes ? ColumnTypes[T] : {}>
    : Retype<GeneratedTables[T][P], T extends keyof ColumnTypes ? ColumnTypes[T] : {}>;

type Tables = {
  [T in keyof GeneratedTables]: {
    Row: Part<T, "Row">;
    Insert: Part<T, "Insert">;
    Update: Part<T, "Update">;
    Relationships: GeneratedTables[T]["Relationships"];
  };
};

export type Database = {
  public: {
    Tables: Tables;
    Views: Generated["public"]["Views"];
    Functions: Generated["public"]["Functions"];
    Enums: Generated["public"]["Enums"];
    CompositeTypes: Generated["public"]["CompositeTypes"];
  };
};

/** A table's row, insert or update shape, by name. */
export type TableRow<T extends keyof Tables> = Tables[T]["Row"];
export type TableInsert<T extends keyof Tables> = Tables[T]["Insert"];
export type TableUpdate<T extends keyof Tables> = Tables[T]["Update"];


// Convenience types
export type Family = Database["public"]["Tables"]["families"]["Row"];
export type Device = Database["public"]["Tables"]["devices"]["Row"];
export type Person = Database["public"]["Tables"]["people"]["Row"];
export type Calendar = Database["public"]["Tables"]["calendars"]["Row"];
export type CatalogueItem = Database["public"]["Tables"]["catalogue_items"]["Row"];
export type CatalogueItemInsert = Database["public"]["Tables"]["catalogue_items"]["Insert"];
export type Room = Database["public"]["Tables"]["rooms"]["Row"];
export type RoomInsert = Database["public"]["Tables"]["rooms"]["Insert"];
export type Event = Database["public"]["Tables"]["events"]["Row"];
export type Todo = Database["public"]["Tables"]["todos"]["Row"];
export type PointAwardRow = Database["public"]["Tables"]["todo_point_awards"]["Row"];
export type TodoOccurrence = Database["public"]["Tables"]["todo_occurrences"]["Row"];
export type TodoEvent = Database["public"]["Tables"]["todo_events"]["Row"];
export type ShoppingItem = Database["public"]["Tables"]["shopping_items"]["Row"];
export type Subject = Database["public"]["Tables"]["subjects"]["Row"];
export type Schedule = Database["public"]["Tables"]["schedules"]["Row"];
export type Birthday = Database["public"]["Tables"]["birthdays"]["Row"];
export type BirthdayGiftIdea = Database["public"]["Tables"]["birthday_gift_ideas"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type MessageInsert = Database["public"]["Tables"]["messages"]["Insert"];
export type Note = Database["public"]["Tables"]["notes"]["Row"];

// Recipe types
export type Recipe = Database["public"]["Tables"]["recipes"]["Row"];
export type RecipeIngredient = Database["public"]["Tables"]["recipe_ingredients"]["Row"];
export type RecipeTag = Database["public"]["Tables"]["recipe_tags"]["Row"];

// Meal planner types
export type MealPlan = Database["public"]["Tables"]["meal_plans"]["Row"];
export type MealPlanEntry = Database["public"]["Tables"]["meal_plan_entries"]["Row"];
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

// Item catalog types
export type ItemCatalog = Database["public"]["Tables"]["item_catalog"]["Row"];

// Notification types
export type PushSubscription = Database["public"]["Tables"]["push_subscriptions"]["Row"];
export type NotificationPreferences = Database["public"]["Tables"]["notification_preferences"]["Row"];
export type ScheduledNotification = Database["public"]["Tables"]["scheduled_notifications"]["Row"];
export type NotificationLog = Database["public"]["Tables"]["notification_logs"]["Row"];

// Vehicle types
export type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
export type VehicleInsert = Database["public"]["Tables"]["vehicles"]["Insert"];
export type VehicleUpdate = Database["public"]["Tables"]["vehicles"]["Update"];

// Media player types
export type MediaPlayer = Database["public"]["Tables"]["media_players"]["Row"];
export type MediaPlayerInsert =
  Database["public"]["Tables"]["media_players"]["Insert"];
export type MediaPlayerUpdate =
  Database["public"]["Tables"]["media_players"]["Update"];

// Stonks / ticker types
export type Ticker = Database["public"]["Tables"]["tickers"]["Row"];
export type TickerInsert = Database["public"]["Tables"]["tickers"]["Insert"];
export type TickerUpdate = Database["public"]["Tables"]["tickers"]["Update"];

// Kitchen timer types
export type Timer = Database["public"]["Tables"]["timers"]["Row"];
export type TimerInsert = Database["public"]["Tables"]["timers"]["Insert"];

// Pocket Money (Piggy) types
export type PocketMoneyAccount = Database["public"]["Tables"]["pocket_money_accounts"]["Row"];
export type PocketMoneyAccountInsert = Database["public"]["Tables"]["pocket_money_accounts"]["Insert"];
export type PocketMoneyAccountUpdate = Database["public"]["Tables"]["pocket_money_accounts"]["Update"];
export type PocketMoneyTransaction = Database["public"]["Tables"]["pocket_money_transactions"]["Row"];
export type PocketMoneyTransactionInsert = Database["public"]["Tables"]["pocket_money_transactions"]["Insert"];
export type PocketMoneyGoal = Database["public"]["Tables"]["pocket_money_goals"]["Row"];
export type PocketMoneyGoalInsert = Database["public"]["Tables"]["pocket_money_goals"]["Insert"];
export type PocketMoneyGoalUpdate = Database["public"]["Tables"]["pocket_money_goals"]["Update"];
export type PocketMoneyWithdrawalRequest = Database["public"]["Tables"]["pocket_money_withdrawal_requests"]["Row"];
export type PocketMoneyWithdrawalRequestInsert = Database["public"]["Tables"]["pocket_money_withdrawal_requests"]["Insert"];
export type PointReward = Database["public"]["Tables"]["point_rewards"]["Row"];
export type PointRedemption = Database["public"]["Tables"]["point_redemptions"]["Row"];

// Something a child bought in the creature shop (RFC-017 §5).
export type PointPurchase = Database["public"]["Tables"]["point_purchases"]["Row"];

// A child's creature (RFC-017): core, not pocket money.
export type Creature = Database["public"]["Tables"]["creatures"]["Row"];
export type CreatureUpdate = Database["public"]["Tables"]["creatures"]["Update"];

// Recipe instruction type
export interface RecipeInstruction {
  step: number;
  text: string;
  image_url?: string;
}

// Recipe with ingredients (joined)
export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
  tags?: RecipeTag[];
}

// Meal plan entry with recipe (joined)
export interface MealPlanEntryWithRecipe extends MealPlanEntry {
  recipe: Recipe | null;
}

// Shopping item with recipe name (for display)
export interface ShoppingItemWithRecipe extends ShoppingItem {
  recipe_name?: string;
}
