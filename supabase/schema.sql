create extension if not exists pgcrypto;
create table if not exists public.news_articles (
 id uuid primary key default gen_random_uuid(),
 url text not null unique,
 title text not null,
 summary text,
 published_at timestamptz,
 source text,
 created_at timestamptz not null default now()
);
create table if not exists public.drafts (
 id uuid primary key default gen_random_uuid(),
 article_id uuid not null references public.news_articles(id),
 status text not null default 'pending_review' check(status in ('pending_review','changes_requested','approved','rejected','publishing','published','publish_uncertain','failed')),
 current_version integer not null default 1,
 approved_version integer,
 approved_by uuid,
 approved_at timestamptz,
 linkedin_post_id text,
 created_at timestamptz not null default now(),
 constraint approved_pair check ((approved_version is null and approved_by is null and approved_at is null) or (approved_version is not null and approved_by is not null and approved_at is not null))
);
create table if not exists public.draft_versions (
 draft_id uuid not null references public.drafts(id) on delete cascade,
 version integer not null,
 body text not null,
 image_url text,
 feedback text,
 created_at timestamptz not null default now(),
 primary key(draft_id,version)
);
create table if not exists public.review_events (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.drafts(id),
 version integer not null,
 actor uuid not null,
 action text not null check(action in ('approve','request_changes','reject')),
 feedback text,
 created_at timestamptz not null default now()
);
create table if not exists public.publish_attempts (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.drafts(id),
 version integer not null,
 state text not null check(state in ('claimed','succeeded','uncertain','failed')),
 response jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.reviewers (user_id uuid primary key references auth.users(id));
alter table public.news_articles enable row level security;
alter table public.drafts enable row level security;
alter table public.draft_versions enable row level security;
alter table public.review_events enable row level security;
alter table public.publish_attempts enable row level security;
alter table public.reviewers enable row level security;
-- All access through server endpoints after explicit reviewer authorization.
-- No client-facing table policies. Service-role key must remain server-only.
create or replace function public.claim_approved_draft(p_id uuid)
returns table (draft_id uuid, version integer, body text, image_url text)
language plpgsql security definer set search_path = public as $$
begin
 return query
 with claimed as (
  update public.drafts d set status='publishing'
  where d.id=p_id and d.status='approved' and d.approved_version=d.current_version
  returning d.id, d.current_version
 )
 select c.id,c.current_version,v.body,v.image_url
 from claimed c join public.draft_versions v on v.draft_id=c.id and v.version=c.current_version;
end $$;
revoke all on function public.claim_approved_draft(uuid) from public, anon, authenticated;
grant execute on function public.claim_approved_draft(uuid) to service_role;
