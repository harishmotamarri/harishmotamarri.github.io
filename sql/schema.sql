-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- 1. Create visitor_sessions table
create table if not exists visitor_sessions (
  id uuid default gen_random_uuid() primary key,
  visitor_id uuid not null,
  session_id text not null unique,
  country text default 'Unknown',
  city text default 'Unknown',
  browser text default 'Unknown',
  operating_system text default 'Unknown',
  device text default 'Desktop',
  screen_width integer,
  screen_height integer,
  language text default 'en',
  timezone text,
  landing_page text default '/',
  current_page text default '/',
  referrer text default 'Direct',
  user_agent text,
  is_returning boolean default false not null,
  visit_duration integer default 0 not null, -- in seconds
  max_scroll_percentage numeric(5, 2) default 0.00 not null,
  started_at timestamptz default now() not null,
  last_seen timestamptz default now() not null,
  ended_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 2. Create page_views table
create table if not exists page_views (
  id uuid default gen_random_uuid() primary key,
  session_id text not null references visitor_sessions(session_id) on delete cascade,
  page text not null,
  title text,
  visited_at timestamptz default now() not null
);

-- 3. Create contact_messages table (replaces contact_submissions)
create table if not exists contact_messages (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  email text not null,
  message text not null,
  status text default 'unread' not null check (status in ('unread', 'read', 'replied')),
  created_at timestamptz default now() not null
);

-- 4. Create resume_downloads table
create table if not exists resume_downloads (
  id uuid default gen_random_uuid() primary key,
  session_id text not null references visitor_sessions(session_id) on delete cascade,
  downloaded_at timestamptz default now() not null
);

-- 5. Create project_clicks table
create table if not exists project_clicks (
  id uuid default gen_random_uuid() primary key,
  session_id text not null references visitor_sessions(session_id) on delete cascade,
  project_name text not null,
  clicked_at timestamptz default now() not null
);

-- Index Optimizations for Queries & Joins
create index if not exists idx_sessions_visitor_id on visitor_sessions (visitor_id);
create index if not exists idx_sessions_session_id on visitor_sessions (session_id);
create index if not exists idx_sessions_started_at on visitor_sessions (started_at desc);
create index if not exists idx_pageviews_session_id on page_views (session_id);
create index if not exists idx_pageviews_visited_at on page_views (visited_at desc);
create index if not exists idx_downloads_session_id on resume_downloads (session_id);
create index if not exists idx_clicks_session_id on project_clicks (session_id);
create index if not exists idx_messages_created_at on contact_messages (created_at desc);

-- Database Views for Chart Aggregations
create or replace view daily_visitors_view as
select 
  (started_at at time zone 'utc')::date as date,
  count(distinct visitor_id) as visitors,
  count(*) as sessions
from visitor_sessions
group by (started_at at time zone 'utc')::date
order by date asc;

create or replace view weekly_visitors_view as
select 
  date_trunc('week', started_at at time zone 'utc')::date as week,
  count(distinct visitor_id) as visitors,
  count(*) as sessions
from visitor_sessions
group by date_trunc('week', started_at at time zone 'utc')::date
order by week asc;

create or replace view monthly_visitors_view as
select 
  date_trunc('month', started_at at time zone 'utc')::date as month,
  count(distinct visitor_id) as visitors,
  count(*) as sessions
from visitor_sessions
group by date_trunc('month', started_at at time zone 'utc')::date
order by month asc;
