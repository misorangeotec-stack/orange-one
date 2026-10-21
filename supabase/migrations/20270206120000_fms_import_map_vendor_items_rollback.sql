-- Rollback for 20270206120000_fms_import_map_vendor_items.
-- Drops the function only. Mappings it created stay (they are ordinary rows in
-- fms_import_vendor_item_prices, identical to ones made in Masters).
drop function if exists public.fms_import_map_vendor_items(uuid, uuid[]);
