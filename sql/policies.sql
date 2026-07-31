-- 1. Enable RLS on all tables
alter table visitor_sessions enable row level security;
alter table page_views enable row level security;
alter table contact_messages enable row level security;
alter table resume_downloads enable row level security;
alter table project_clicks enable row level security;

-- 2. visitor_sessions policies
create policy "Allow public insert to visitor_sessions"
  on visitor_sessions for insert
  with check (true);

create policy "Allow public update to visitor_sessions"
  on visitor_sessions for update
  using (true)
  with check (true);

create policy "Allow authenticated admin select from visitor_sessions"
  on visitor_sessions for select
  using (auth.role() = 'authenticated');

create policy "Allow authenticated admin delete from visitor_sessions"
  on visitor_sessions for delete
  using (auth.role() = 'authenticated');


-- 3. page_views policies
create policy "Allow public insert to page_views"
  on page_views for insert
  with check (true);

create policy "Allow authenticated admin select from page_views"
  on page_views for select
  using (auth.role() = 'authenticated');


-- 4. contact_messages policies
create policy "Allow public insert to contact_messages"
  on contact_messages for insert
  with check (true);

create policy "Allow authenticated admin all operations on contact_messages"
  on contact_messages for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');


-- 5. resume_downloads policies
create policy "Allow public insert to resume_downloads"
  on resume_downloads for insert
  with check (true);

create policy "Allow authenticated admin select from resume_downloads"
  on resume_downloads for select
  using (auth.role() = 'authenticated');


-- 6. project_clicks policies
create policy "Allow public insert to project_clicks"
  on project_clicks for insert
  with check (true);

create policy "Allow authenticated admin select from project_clicks"
  on project_clicks for select
  using (auth.role() = 'authenticated');
