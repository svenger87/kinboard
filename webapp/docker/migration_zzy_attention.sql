-- migration_zzy_attention.sql — the Heute-Motor's data model (plan §Phase 3).
--
-- WHAT IS AND IS NOT IN THE DATABASE
--
-- The rules themselves are code, not rows. A rule is a small deterministic
-- function of the signals and the clock, and the plan's first exit criterion
-- is that the same data produces the same items — which means rules have to be
-- reviewable, diffable and unit-testable, and a JSONB rule DSL in a table is
-- none of those. What lives here is only what a *family* decides:
-- which rules they want (`context_rules`), and what they have already dealt
-- with (`attention_items`).
--
-- WHY ITEMS ARE STORED AT ALL
--
-- The set of items is derivable from the signals, so it could be recomputed on
-- every request and never stored. It is stored because the interesting state
-- is not the item, it is the human response to it: acknowledged, snoozed until
-- after school, disabled forever. That state has to survive re-evaluation, and
-- it has to attach to something stable.
--
-- Hence `item_key`: a deterministic identity for "this rule, about this
-- thing", computed by the rule rather than assigned by the database. Two
-- evaluations of the same situation produce the same key, so an
-- acknowledgement made at 07:00 still applies at 07:01. A UUID primary key
-- would have made every evaluation produce new rows and lose the response.
--
-- The file sorts after migration_zz_row_level_security.sql (LC_ALL=C: `zz_`
-- before `zzy`), so public.current_family_id() exists by the time the policies
-- below reference it. Those policies are defined here rather than added to
-- that file's table list, because that file runs FIRST on a fresh install —
-- a table created here would be skipped by its loop and left unprotected
-- until the second boot.

-- --------------------------------------------------------------- rule state

CREATE TABLE IF NOT EXISTS public.context_rules (
  family_id   UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- Matches a rule id declared in code. Deliberately TEXT and not a foreign
  -- key to anything: a family that has disabled a rule which a later release
  -- removes should keep working, and a rule that exists in code but has no row
  -- here simply runs with its defaults.
  rule_id     TEXT NOT NULL,

  -- Absent row means "on". The plan requires every hint to be disableable from
  -- itself, and the cheapest way to honour that is to store only the
  -- exceptions: a family that has never opened the settings has no rows and
  -- gets every rule.
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,

  -- Per-family thresholds — how many minutes before an appointment to warn,
  -- which children a rule applies to. Validated by the rule that reads it, not
  -- by a constraint here, because the shape differs per rule.
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (family_id, rule_id)
);

-- --------------------------------------------------------------------- items

CREATE TABLE IF NOT EXISTS public.attention_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- Which rule said so. Required, not nullable: an item nobody can trace back
  -- to a rule cannot be explained and cannot be turned off, and the plan
  -- forbids both.
  rule_id        TEXT NOT NULL,

  -- Stable identity for "this rule, about this thing". See the note above.
  item_key       TEXT NOT NULL,

  -- What a person reads. `detail` is the explanation — not a restatement of
  -- the title, but why this is being shown now.
  title          TEXT NOT NULL,
  detail         TEXT,

  -- The inputs the rule used. This is what makes "why am I seeing this?"
  -- answerable without re-running anything, including for an item raised
  -- yesterday against data that has since changed.
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Lower sorts first. An int rather than an enum so a rule can place itself
  -- between two others without a schema change.
  priority       INT NOT NULL DEFAULT 100,

  -- Which part of the day this belongs to, or NULL for any. The plan's
  -- contexts: morning, afternoon, evening, quiet.
  context        TEXT,

  -- What it is about, when it is about something: an event, a todo, a person.
  -- Free text rather than a foreign key because it spans tables, and a hard
  -- reference would make deleting the subject fail rather than the item
  -- quietly stop being produced.
  subject_type   TEXT,
  subject_id     UUID,

  state          TEXT NOT NULL DEFAULT 'active'
                 CHECK (state IN ('active', 'acknowledged', 'snoozed', 'dismissed')),
  snoozed_until  TIMESTAMPTZ,
  acted_at       TIMESTAMPTZ,
  acted_by       UUID REFERENCES public.people(id) ON DELETE SET NULL,

  -- first_seen_at is when the situation arose; last_seen_at is the most recent
  -- evaluation that still produced it. Keeping both means "this has been true
  -- for three days" is answerable, which is exactly the kind of thing a family
  -- notices and the board should be able to say.
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Set when a rule stops producing the item. Kept rather than deleted so the
  -- Today view can show what has already been dealt with today, and so a
  -- flapping signal does not produce a fresh item every few minutes.
  resolved_at    TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The identity that makes re-evaluation idempotent. Partial, on unresolved
-- rows only: the same situation recurring next week is a new item with the
-- same key, and should not collide with the one that was resolved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_items_live_key
  ON public.attention_items (family_id, item_key)
  WHERE resolved_at IS NULL;

-- The Today view's query: this family, still open, in priority order.
CREATE INDEX IF NOT EXISTS idx_attention_items_open
  ON public.attention_items (family_id, priority, first_seen_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attention_items_rule
  ON public.attention_items (family_id, rule_id);

-- ----------------------------------------------------------------- policies
--
-- Both tables carry family_id, so they take the same family-scope shape as
-- every other such table. Written out here rather than added to the RLS
-- migration's list — see the note at the top about ordering on a fresh
-- install.

ALTER TABLE public.context_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS context_rules_family_scope ON public.context_rules;
CREATE POLICY context_rules_family_scope ON public.context_rules
  FOR ALL
  USING (family_id = public.current_family_id())
  WITH CHECK (family_id = public.current_family_id());

ALTER TABLE public.attention_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attention_items_family_scope ON public.attention_items;
CREATE POLICY attention_items_family_scope ON public.attention_items
  FOR ALL
  USING (family_id = public.current_family_id())
  WITH CHECK (family_id = public.current_family_id());

-- The wall display and phones read both through PostgREST, and acknowledge or
-- snooze an item from there, so the browser roles need more than SELECT. RLS
-- above is what confines them to their own family.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.context_rules TO anon, authenticated;
GRANT SELECT, UPDATE ON public.attention_items TO anon, authenticated;

-- Raising and resolving items is the evaluator's job, and it runs server-side.
-- A browser that could INSERT could invent an alert; one that could DELETE
-- could hide one. Both are withheld deliberately — the browser may only
-- respond to an item, which is what the UPDATE grant above allows.
--
-- TRUNCATE is revoked with them, and it is the one that matters most: unlike
-- every other privilege here it is NOT filtered by row-level security, so a
-- role holding it empties the table for every family at once, not just its
-- own. The Supabase image grants it to anon and authenticated by default —
-- `events`, `families`, `shopping_items` and `todos` all still carry it, which
-- is worth revisiting separately. PostgREST does not expose TRUNCATE, so it is
-- not reachable over the API today; that is a reason not to rely on it.
REVOKE INSERT, DELETE, TRUNCATE ON public.attention_items FROM anon, authenticated;
