-- Rollback for 20261230120000_fms_dispatch_round_sales_return.
--
-- ⚠ DROPS THE TABLE, and with it every sales return recorded against a finished
--   invoice. Export it first if any rows are real.
--
-- The mail arm is cut back out of the LIVE body the same way it went in, so any
-- other change made to fms_dispatch_email_payload since is kept.
begin;

drop trigger if exists trg_dispatch_rounds_returned_opens_return on public.fms_dispatch_rounds;
drop function if exists public.fms_dispatch_round_returned_opens_return();
drop function if exists public.fms_dispatch_request_round_return(uuid, integer, jsonb);
drop function if exists public.fms_dispatch_record_round_return(uuid, jsonb);
drop function if exists public.fms_dispatch_update_round_return(uuid, jsonb);
drop function if exists public.fms_dispatch_withdraw_round_return(uuid, text);
drop function if exists public.fms_dispatch_open_round_return(uuid, integer, text, text, text, jsonb);
drop function if exists public.fms_dispatch_invoice_lines(uuid, integer);
drop table if exists public.fms_dispatch_round_returns;

do $mail$
declare
  src   text := pg_get_functiondef('public.fms_dispatch_email_payload(text,uuid,text,text,jsonb)'::regprocedure);
  -- From the NEWLINE before the arm's first comment: the arm went in as $arm$<newline>…,
  -- so cutting from the comment alone leaves one stray blank line behind.
  start int  := position(E'\n  -- ---- Sales return against a finished round''s invoice (20261230120000).' in src);
  stop  int  := position('  -- ⚠ The announcing RPC captures round_no' in src);
begin
  if start = 0 then return; end if;
  if stop = 0 or stop < start then
    raise exception 'cannot find the end of the sales-return mail arm - remove it by hand';
  end if;
  execute substr(src, 1, start - 1) || substr(src, stop);
end $mail$;

commit;
