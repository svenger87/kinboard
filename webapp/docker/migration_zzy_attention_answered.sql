-- Answered-item lookup for the Heute-Motor.
--
-- The evaluator now checks, before raising an item, whether the family already
-- answered this exact key and the item was merely resolved by a context
-- boundary since. That query asks for *resolved* rows by (family_id, item_key),
-- and every index on the table until now was partial on `resolved_at IS NULL` —
-- exactly the opposite half. On today's few dozen rows that is a scan nobody
-- would notice; the table has no retention job, so it will not stay that way.
--
-- Runs on every start and may run twice concurrently (host and entrypoint both
-- apply migrations), so it has to be idempotent — hence IF NOT EXISTS, and a
-- plain CREATE INDEX rather than CONCURRENTLY, which cannot run in the
-- transaction the runner wraps this in.

CREATE INDEX IF NOT EXISTS idx_attention_items_answered
  ON public.attention_items (family_id, item_key, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;
