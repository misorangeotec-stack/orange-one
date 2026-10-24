-- Reverses 20270211120000_ink_expiry_settings.sql. The page falls back to its default
-- (Enterprises Surat: FINISHED GOODS-SACHIN and HOJIWALA counted) when the table is gone.
begin;
drop policy if exists ink_expiry_settings_write  on public.ink_expiry_settings;
drop policy if exists ink_expiry_settings_select on public.ink_expiry_settings;
drop table if exists public.ink_expiry_settings;
commit;
