-- Run after 02_workflow.sql. Adds manual reconciliation for drafts stuck after a publish attempt.
alter table public.publish_attempts add column if not exists reconciled_by uuid;
alter table public.publish_attempts add column if not exists reconciled_at timestamptz;
alter table public.publish_attempts add column if not exists reconcile_note text;

create or replace function public.reconcile_draft(p_id uuid,p_actor uuid,p_outcome text,p_post_id text default null,p_note text default null)
returns text language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
 if not exists(select 1 from public.reviewers where user_id=p_actor) then raise exception 'not a reviewer'; end if;
 if p_outcome not in ('posted','not_posted') then raise exception 'invalid outcome'; end if;
 select status into v_status from public.drafts where id=p_id for update;
 if v_status is null or v_status not in ('publishing','publish_uncertain','failed') then raise exception 'draft does not need reconciliation'; end if;

 -- Close every open attempt so the one-claim index allows a later retry.
 update public.publish_attempts
 set state=case p_outcome when 'posted' then 'succeeded' else 'failed' end,
     error_code=coalesce(error_code,'')||case when coalesce(error_code,'')='' then '' else ';' end||'reconciled_'||p_outcome,
     reconciled_by=p_actor,reconciled_at=now(),reconcile_note=p_note
 where draft_id=p_id and state in ('claimed','uncertain');

 if p_outcome='posted' then
  update public.drafts set status='published',linkedin_post_id=coalesce(nullif(trim(p_post_id),''),linkedin_post_id) where id=p_id;
  return 'published';
 end if;
 -- Not on LinkedIn: return to approved so the same approved version can be published again.
 update public.drafts set status='approved' where id=p_id and approved_version=current_version;
 if not found then raise exception 'approved version missing'; end if;
 return 'approved';
end $$;

revoke all on function public.reconcile_draft(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_draft(uuid,uuid,text,text,text) to service_role;
