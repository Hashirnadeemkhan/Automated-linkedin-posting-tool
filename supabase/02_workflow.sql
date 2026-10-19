-- Run after schema.sql. All functions remain service-role only.
create table if not exists public.linkedin_connections (
 reviewer_id uuid primary key references public.reviewers(user_id),
 member_sub text not null,
 access_token_ciphertext text not null,
 refresh_token_ciphertext text,
 expires_at timestamptz not null,
 refresh_expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.linkedin_connections enable row level security;
alter table public.publish_attempts add column if not exists error_code text;
create unique index if not exists one_publish_claim_per_draft on public.publish_attempts(draft_id) where state in ('claimed','succeeded','uncertain');

create or replace function public.review_draft(p_id uuid,p_version integer,p_actor uuid,p_action text,p_feedback text default null)
returns text language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
 if not exists(select 1 from public.reviewers where user_id=p_actor) then raise exception 'not a reviewer'; end if;
 if p_action not in ('approve','request_changes','reject') then raise exception 'invalid action'; end if;
 if p_action='request_changes' and nullif(trim(coalesce(p_feedback,'')),'') is null then raise exception 'feedback required'; end if;
 update public.drafts set status=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
 approved_version=case when p_action='approve' then p_version else null end,
 approved_by=case when p_action='approve' then p_actor else null end,
 approved_at=case when p_action='approve' then now() else null end
 where id=p_id and status='pending_review' and current_version=p_version returning status into v_status;
 if v_status is null then raise exception 'stale or unavailable version'; end if;
 insert into public.review_events(draft_id,version,actor,action,feedback) values(p_id,p_version,p_actor,p_action,p_feedback);
 return v_status;
end $$;

create or replace function public.add_draft_version(p_id uuid,p_expected_version integer,p_actor uuid,p_body text,p_image_url text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_version integer;
begin
 if not exists(select 1 from public.reviewers where user_id=p_actor) then raise exception 'not a reviewer'; end if;
 if length(trim(coalesce(p_body,'')))<10 or length(p_body)>3000 then raise exception 'invalid body'; end if;
 update public.drafts set current_version=current_version+1,status='pending_review',approved_version=null,approved_by=null,approved_at=null
 where id=p_id and current_version=p_expected_version and status in ('pending_review','changes_requested')
 returning current_version into v_version;
 if v_version is null then raise exception 'stale or unavailable version'; end if;
 insert into public.draft_versions(draft_id,version,body,image_url) values(p_id,v_version,p_body,p_image_url);
 return v_version;
end $$;

drop function if exists public.claim_approved_draft(uuid);
create function public.claim_approved_draft(p_id uuid)
returns table(draft_id uuid,version integer,body text,image_url text,attempt_id uuid,approved_by uuid)
language plpgsql security definer set search_path=public as $$
declare v_draft public.drafts%rowtype; v_attempt uuid;
begin
 update public.drafts d set status='publishing' where d.id=p_id and d.status='approved' and d.approved_version=d.current_version
 returning d.* into v_draft;
 if not found then return; end if;
 insert into public.publish_attempts(draft_id,version,state) values(p_id,v_draft.current_version,'claimed') returning id into v_attempt;
 return query select p_id,v_draft.current_version,v.body,v.image_url,v_attempt,v_draft.approved_by
 from public.draft_versions v where v.draft_id=p_id and v.version=v_draft.current_version;
end $$;

create or replace function public.finish_publish_attempt(p_attempt uuid,p_state text,p_post_id text default null,p_response jsonb default null,p_error_code text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_draft uuid;
begin
 if p_state not in ('succeeded','uncertain','failed') then raise exception 'invalid state'; end if;
 update public.publish_attempts set state=p_state,response=p_response,error_code=p_error_code where id=p_attempt and state='claimed' returning draft_id into v_draft;
 if v_draft is null then raise exception 'attempt already finished'; end if;
 update public.drafts set status=case p_state when 'succeeded' then 'published' when 'uncertain' then 'publish_uncertain' else 'failed' end,
 linkedin_post_id=case when p_state='succeeded' then p_post_id else linkedin_post_id end where id=v_draft and status='publishing';
end $$;

revoke all on function public.review_draft(uuid,integer,uuid,text,text) from public,anon,authenticated;
revoke all on function public.add_draft_version(uuid,integer,uuid,text,text) from public,anon,authenticated;
revoke all on function public.claim_approved_draft(uuid) from public,anon,authenticated;
revoke all on function public.finish_publish_attempt(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.review_draft(uuid,integer,uuid,text,text) to service_role;
grant execute on function public.add_draft_version(uuid,integer,uuid,text,text) to service_role;
grant execute on function public.claim_approved_draft(uuid) to service_role;
grant execute on function public.finish_publish_attempt(uuid,text,text,jsonb,text) to service_role;
