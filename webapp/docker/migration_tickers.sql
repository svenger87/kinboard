-- migration_tickers.sql
-- Adds the `tickers` table for the Stonks plugin (watchlist of stocks,
-- ETFs, crypto, indices, forex). Multi-row per family — one row per
-- watched symbol. Mirrors the `vehicles` table shape (the closest
-- precedent in the codebase): family-scoped, position-ordered, with
-- a vendor/asset-type discriminator and a flexible config JSONB blob.
--
-- Idempotent: re-running on an already-migrated stack is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tickers'
  ) THEN
    CREATE TABLE public.tickers (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      -- The Yahoo Finance symbol — `AAPL`, `BTC-USD`, `^GSPC`, `EURUSD=X`.
      -- Validated at the application layer (the API route checks Yahoo
      -- finds it before insert).
      symbol TEXT NOT NULL,
      -- See `webapp/src/lib/stonks/types.ts` for the canonical enum.
      -- Future vendors require an ALTER TABLE … DROP CONSTRAINT … ADD
      -- CONSTRAINT migration; Postgres has no `ADD CONSTRAINT IF NOT
      -- EXISTS` for CHECKs.
      asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'etf', 'crypto', 'index', 'forex')),
      nickname TEXT,
      color TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX tickers_family_id_position_idx
      ON public.tickers (family_id, position);

    CREATE TRIGGER tickers_set_updated_at
      BEFORE UPDATE ON public.tickers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
