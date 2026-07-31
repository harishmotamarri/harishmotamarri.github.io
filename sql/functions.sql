-- Stored procedure (RPC) for calculating analytics dashboard metrics
create or replace function get_admin_analytics_summary()
returns json
language plpgsql
security definer
as $$
declare
  total_visitors bigint;
  today_visitors bigint;
  week_visitors bigint;
  month_visitors bigint;
  returning_visitors bigint;
  avg_duration numeric;
  avg_scroll numeric;
  top_countries json;
  top_browsers json;
  top_devices json;
  top_pages json;
  top_projects json;
  recent_visitors json;
  recent_messages json;
  total_downloads bigint;
begin
  -- Total distinct visitors
  select count(distinct visitor_id) into total_visitors from visitor_sessions;

  -- Today's visitors (last 24 hours)
  select count(distinct visitor_id) into today_visitors from visitor_sessions where started_at >= now() - interval '24 hours';

  -- This week's visitors (last 7 days)
  select count(distinct visitor_id) into week_visitors from visitor_sessions where started_at >= now() - interval '7 days';

  -- This month's visitors (last 30 days)
  select count(distinct visitor_id) into month_visitors from visitor_sessions where started_at >= now() - interval '30 days';

  -- Returning visitors
  select count(*) into returning_visitors from visitor_sessions where is_returning = true;

  -- Average session duration (where duration > 0)
  select coalesce(round(avg(visit_duration)::numeric, 1), 0) into avg_duration from visitor_sessions where visit_duration > 0;

  -- Average scroll percentage
  select coalesce(round(avg(max_scroll_percentage)::numeric, 1), 0) into avg_scroll from visitor_sessions;

  -- Top countries (limit 5)
  select coalesce(json_agg(t), '[]'::json) into top_countries from (
    select country, count(*) as count 
    from visitor_sessions 
    group by country 
    order by count desc 
    limit 5
  ) t;

  -- Top browsers (limit 5)
  select coalesce(json_agg(t), '[]'::json) into top_browsers from (
    select browser, count(*) as count 
    from visitor_sessions 
    group by browser 
    order by count desc 
    limit 5
  ) t;

  -- Top devices (limit 5)
  select coalesce(json_agg(t), '[]'::json) into top_devices from (
    select device, count(*) as count 
    from visitor_sessions 
    group by device 
    order by count desc 
    limit 5
  ) t;

  -- Top pages (limit 5)
  select coalesce(json_agg(t), '[]'::json) into top_pages from (
    select page, count(*) as count 
    from page_views 
    group by page 
    order by count desc 
    limit 5
  ) t;

  -- Top projects (limit 5)
  select coalesce(json_agg(t), '[]'::json) into top_projects from (
    select project_name, count(*) as count 
    from project_clicks 
    group by project_name 
    order by count desc 
    limit 5
  ) t;

  -- Total downloads
  select count(*) into total_downloads from resume_downloads;

  -- Recent visitors (latest 10 sessions)
  select coalesce(json_agg(t), '[]'::json) into recent_visitors from (
    select id, visitor_id, session_id, country, city, browser, operating_system, device, landing_page, current_page, visit_duration, max_scroll_percentage, started_at
    from visitor_sessions
    order by started_at desc
    limit 10
  ) t;

  -- Recent contact messages (latest 5)
  select coalesce(json_agg(t), '[]'::json) into recent_messages from (
    select id, name, email, message, status, created_at
    from contact_messages
    order by created_at desc
    limit 5
  ) t;

  return json_build_object(
    'totalVisitors', total_visitors,
    'todayVisitors', today_visitors,
    'weekVisitors', week_visitors,
    'monthVisitors', month_visitors,
    'returningVisitors', returning_visitors,
    'avgDuration', avg_duration,
    'avgScroll', avg_scroll,
    'topCountries', top_countries,
    'topBrowsers', top_browsers,
    'topDevices', top_devices,
    'topPages', top_pages,
    'topProjects', top_projects,
    'totalDownloads', total_downloads,
    'recentVisitors', recent_visitors,
    'recentMessages', recent_messages
  );
end;
$$;

-- Function Permissions:
-- By default, grant execution to authenticated role (logged-in admin)
revoke execute on function get_admin_analytics_summary() from public;
revoke execute on function get_admin_analytics_summary() from anon;
grant execute on function get_admin_analytics_summary() to authenticated;

-- OPTIONAL: If you wish to allow anonymous / unauthenticated visitors to read dashboard stats (e.g. for a public demo), run:
-- grant execute on function get_admin_analytics_summary() to anon, authenticated;

-- Public Stored Procedure (RPC) to retrieve total distinct visitor count for public badge
create or replace function get_visitor_count()
returns bigint
language sql
security definer
as $$
  select count(distinct visitor_id) from visitor_sessions;
$$;

-- Alias for backwards compatibility
create or replace function increment_visitor_count()
returns bigint
language sql
security definer
as $$
  select count(distinct visitor_id) from visitor_sessions;
$$;

grant execute on function get_visitor_count() to anon, authenticated;
grant execute on function increment_visitor_count() to anon, authenticated;

