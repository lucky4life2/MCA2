-- Display names are shown in headings and member lists. Cap new values at
-- 40 characters so a long unbroken name cannot overflow narrow layouts.
-- Existing TEST/live display names were checked before this migration:
-- no profile exceeded 40 characters.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_display_name_length_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length_check
  CHECK (display_name IS NULL OR char_length(display_name) <= 40);
