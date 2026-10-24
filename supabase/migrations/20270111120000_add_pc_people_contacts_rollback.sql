-- Rollback for 20270111120000_add_pc_people_contacts.sql
-- The Call List falls back to pc_step_owner_contacts() for phone numbers when this
-- function is missing, so dropping it degrades the screen rather than breaking it.
drop function if exists public.pc_people_contacts();
