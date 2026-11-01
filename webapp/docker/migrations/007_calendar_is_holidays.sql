-- Migration: Add is_holidays and is_waste_collection columns to calendars table
-- is_holidays: marks a calendar as holidays (e.g. Google public holidays)
-- is_waste_collection: marks a calendar as waste collection (hidden from calendar, shown in Abfuhrplan widget)

ALTER TABLE public.calendars ADD COLUMN IF NOT EXISTS is_holidays BOOLEAN DEFAULT false;
ALTER TABLE public.calendars ADD COLUMN IF NOT EXISTS is_waste_collection BOOLEAN DEFAULT false;
