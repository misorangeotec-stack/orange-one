-- ===========================================================================
-- Purchase FMS — seed the requisition vendor shortlist from existing quotes.
--
-- Requisitions sourced under the OLD per-line model have vendors recorded on
-- fms_purchase_quotations but nothing in fms_purchase_request_vendors, so they
-- would open in the new sourcing form with an empty shortlist. This copies the
-- vendors across so in-flight work carries on unchanged.
--
-- INSERT-only. Deliberately skips any requisition whose lines point at more than
-- one vendor — that shape cannot be represented per-requisition, and guessing a
-- winner would silently rewrite a price. Those keep using the retained per-line
-- functions. (Live check at time of writing: zero such requisitions.)
-- ===========================================================================

insert into public.fms_purchase_request_vendors (request_id, vendor_id, is_recommended, remark, sort_order)
select ri.request_id,
       q.vendor_id,
       bool_or(coalesce(q.is_recommended, false)) as is_recommended,
       null::text                                 as remark,
       0                                          as sort_order
  from public.fms_purchase_quotations q
  join public.fms_purchase_request_items ri on ri.id = q.request_item_id
 where ri.request_id in (
         -- only requisitions with work still open
         select request_id from public.fms_purchase_request_items
          where status in ('sourcing','approval','on_hold')
       )
   and ri.request_id not in (
         -- ...excluding the mixed-vendor shape
         select request_id from public.fms_purchase_request_items
          where final_vendor_id is not null
          group by request_id
         having count(distinct final_vendor_id) > 1
       )
 group by ri.request_id, q.vendor_id
on conflict (request_id, vendor_id) do nothing;

-- A requisition must end up with exactly one recommended vendor. Where the old
-- quotes never flagged one, fall back to whatever the lines were actually sourced
-- to (final_vendor_id) — that is the vendor the approver is looking at.
update public.fms_purchase_request_vendors rv
   set is_recommended = true
 where not exists (
         select 1 from public.fms_purchase_request_vendors x
          where x.request_id = rv.request_id and x.is_recommended
       )
   and rv.vendor_id = (
         select ri.final_vendor_id from public.fms_purchase_request_items ri
          where ri.request_id = rv.request_id and ri.final_vendor_id is not null
          limit 1
       );

-- Mirror the request-level sourcing stamps from the lines, so the new Completed
-- tab attributes legacy work to the right person and time.
update public.fms_purchase_requests r
   set sourced_at = agg.at,
       sourced_by = agg.by,
       sourcing_reason = coalesce(r.sourcing_reason, agg.reason)
  from (
        select ri.request_id,
               max(ri.sourced_at)                                        as at,
               (array_agg(ri.sourced_by order by ri.sourced_at desc))[1] as by,
               (array_agg(ri.sourcing_reason) filter (where ri.sourcing_reason is not null))[1] as reason
          from public.fms_purchase_request_items ri
         where ri.sourced_at is not null
         group by ri.request_id
       ) agg
 where r.id = agg.request_id
   and r.sourced_at is null;
