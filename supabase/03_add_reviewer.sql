-- Run only after this email exists in Supabase Authentication > Users.
-- The Auth account and password must be created through Supabase Auth Admin API.
do $$
declare v_user_id uuid;
begin
 select id into v_user_id
 from auth.users
 where lower(email)=lower('khashir657@gmail.com')
 limit 1;

 if v_user_id is null then
  raise exception 'Reviewer Auth account does not exist yet';
 end if;

 insert into public.reviewers(user_id) values(v_user_id)
 on conflict (user_id) do nothing;
end $$;
