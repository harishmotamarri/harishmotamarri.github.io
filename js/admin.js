/**
 * Visitor Analytics Executive Admin Dashboard Module
 * Uses Supabase Auth, client-side RLS queries, Chart.js, and SaaS Side Drawer
 */
(function initAdminDashboard() {
  const PAGE_SIZE = 10;
  let currentPage = 0;
  let totalSessionsCount = 0;
  let activeSessions = [];

  let currentChartType = 'daily'; // 'daily', 'weekly', 'monthly'
  let visitorsChart = null;
  let realtimeChannel = null;

  // Search & Filter state
  let searchTerm = '';
  let deviceFilter = 'all';

  // Auth check & setup
  const checkAuth = async () => {
    if (!window.supabaseClient) {
      console.error('Supabase client not initialized.');
      showLoginPanel();
      return;
    }

    try {
      const { data: { session }, error } = await window.supabaseClient.auth.getSession();
      
      if (error) throw error;

      if (session) {
        showDashboard();
      } else {
        showLoginPanel();
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      showLoginPanel();
    }

    // Subscribe to Auth state changes
    if (window.supabaseClient.auth && typeof window.supabaseClient.auth.onAuthStateChange === 'function') {
      window.supabaseClient.auth.onAuthStateChange((event, session) => {
        const dashboardContent = document.getElementById('dashboard-main-content');
        if (session) {
          if (!dashboardContent || !dashboardContent.classList.contains('active')) {
            showDashboard();
          }
        } else {
          showLoginPanel();
        }
      });
    }
  };

  // UI State toggles
  const showLoginPanel = () => {
    document.getElementById('login-overlay').classList.add('active');
    document.getElementById('dashboard-main-content').classList.remove('active');
  };

  const showDashboard = () => {
    document.getElementById('login-overlay').classList.remove('active');
    document.getElementById('dashboard-main-content').classList.add('active');
    updateHeaderDate();
    loadDashboardData();
  };

  // Header Date Badge
  const updateHeaderDate = () => {
    const el = document.getElementById('current-date-badge');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Toast Notification Helper
  const showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`;
    let icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';

    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-message">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  };

  // Authenticate Admin
  let isAuthenticating = false;
  const handleLogin = async () => {
    if (isAuthenticating) return;

    const emailField = document.getElementById('login-email');
    const passwordField = document.getElementById('login-password');
    const submitBtn = document.getElementById('btn-login-submit');

    const email = emailField ? emailField.value.trim() : '';
    const password = passwordField ? passwordField.value : '';

    if (!email || !password) {
      showToast('Please enter both email and password.', 'error');
      return;
    }

    isAuthenticating = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Authenticating...</span>';
    }

    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      showToast('Logged in successfully!', 'success');
      showDashboard();
    } catch (err) {
      console.error('Login failed:', err);
      showToast(err.message || 'Authentication failed.', 'error');
    } finally {
      isAuthenticating = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Authenticate</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      }
    }
  };

  // Sign out Admin
  const handleLogout = async () => {
    try {
      if (realtimeChannel && window.supabaseClient) {
        window.supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
      const { error } = await window.supabaseClient.auth.signOut();
      if (error) throw error;
      showToast('Logged out.', 'info');
      showLoginPanel();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // Durations formatter (seconds -> MM:SS or HH:MM)
  const formatDuration = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  };

  // Timestamps formatter
  const formatTimeAgo = (isoString) => {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Render Shimmer Skeletons
  const showLoadingSkeletons = () => {
    const kpiContainer = document.getElementById('kpi-container');
    if (kpiContainer) {
      kpiContainer.innerHTML = Array(6).fill(0).map(() => `
        <div class="admin-card kpi-card">
          <div class="shimmer shimmer-title"></div>
          <div class="shimmer shimmer-value" style="margin-top:8px;"></div>
        </div>
      `).join('');
    }

    const aggregateCards = ['countries', 'browsers', 'devices', 'pages', 'projects'];
    aggregateCards.forEach(c => {
      const el = document.getElementById(`card-${c}`);
      if (el) {
        el.innerHTML = `<h3>Top ${c.charAt(0).toUpperCase() + c.slice(1)}</h3>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
            <div class="shimmer"></div><div class="shimmer"></div><div class="shimmer"></div>
          </div>`;
      }
    });

    const recentTable = document.getElementById('recent-table-wrapper');
    if (recentTable) {
      recentTable.innerHTML = `
        <div style="padding:16px;">
          <div class="shimmer" style="height: 38px; margin-bottom: 12px;"></div>
          <div class="shimmer" style="height: 52px; margin-bottom: 12px;"></div>
          <div class="shimmer" style="height: 52px; margin-bottom: 12px;"></div>
          <div class="shimmer" style="height: 52px;"></div>
        </div>
      `;
    }
    
    const messagesWrapper = document.getElementById('recent-messages-wrapper');
    if (messagesWrapper) {
      messagesWrapper.innerHTML = `
        <div style="padding:16px;">
          <div class="shimmer" style="height: 38px; margin-bottom: 12px;"></div>
          <div class="shimmer" style="height: 60px; margin-bottom: 12px;"></div>
          <div class="shimmer" style="height: 60px;"></div>
        </div>
      `;
    }
  };

  // Fetch KPI Aggregates (using SQL RPC Function)
  const loadKpiSummary = async () => {
    try {
      const { data, error } = await window.supabaseClient.rpc('get_admin_analytics_summary');
      if (error) throw error;
      renderKpis(data);
    } catch (err) {
      console.error('Error loading KPI summary:', err);
      if (err && (err.code === '42501' || (err.message && err.message.toLowerCase().includes('permission denied')))) {
        showToast('Permission denied. Please sign in with an admin account.', 'error');
        showLoginPanel();
      } else {
        showToast('Failed to load KPI statistics.', 'error');
      }
    }
  };

  const renderKpis = (data) => {
    if (!data) return;

    const returningRate = data.totalVisitors > 0
      ? Math.round((data.returningVisitors / data.totalVisitors) * 100)
      : 0;

    const kpiContainer = document.getElementById('kpi-container');
    if (!kpiContainer) return;

    kpiContainer.innerHTML = `
      <div class="admin-card kpi-card">
        <div class="kpi-header-row">
          <span class="kpi-title">Total Visitors</span>
          <div class="kpi-icon-badge">👥</div>
        </div>
        <div class="kpi-value">${data.totalVisitors.toLocaleString()}</div>
        <div class="kpi-trend">↑ All-time unique</div>
      </div>

      <div class="admin-card kpi-card">
        <div class="kpi-header-row">
          <span class="kpi-title">Active (24h)</span>
          <div class="kpi-icon-badge">⚡</div>
        </div>
        <div class="kpi-value">${data.todayVisitors.toLocaleString()}</div>
        <div class="kpi-trend">↑ Last 24 hours</div>
      </div>

      <div class="admin-card kpi-card">
        <div class="kpi-header-row">
          <span class="kpi-title">Weekly Active</span>
          <div class="kpi-icon-badge">📅</div>
        </div>
        <div class="kpi-value">${data.weekVisitors.toLocaleString()}</div>
        <div class="kpi-trend">↑ Last 7 days</div>
      </div>

      <div class="admin-card kpi-card">
        <div class="kpi-header-row">
          <span class="kpi-title">Returning Rate</span>
          <div class="kpi-icon-badge">🔄</div>
        </div>
        <div class="kpi-value">${data.returningVisitors.toLocaleString()}</div>
        <div class="kpi-trend">↑ ${returningRate}% return rate</div>
      </div>

      <div class="admin-card kpi-card">
        <div class="kpi-header-row">
          <span class="kpi-title">Avg Duration</span>
          <div class="kpi-icon-badge">⏱️</div>
        </div>
        <div class="kpi-value">${formatDuration(Math.round(data.avgDuration))}</div>
        <div class="kpi-trend">↑ Per session avg</div>
      </div>

      <div class="admin-card kpi-card">
        <div class="kpi-header-row">
          <span class="kpi-title">Avg Scroll Depth</span>
          <div class="kpi-icon-badge">📜</div>
        </div>
        <div class="kpi-value">${Math.round(data.avgScroll)}%</div>
        <div class="kpi-trend">↑ Page completion</div>
      </div>
    `;

    // Render Breakdown Lists
    renderList('countries', 'Top Countries', data.topCountries, 'country');
    renderList('browsers', 'Top Browsers', data.topBrowsers, 'browser');
    renderList('devices', 'Top Devices', data.topDevices, 'device');
    renderList('pages', 'Top Pages', data.topPages, 'page');
    renderList('projects', 'Top Projects', data.topProjects, 'project_name');
    
    // Add total resume downloads count to projects header
    const projectsHeader = document.querySelector('#card-projects h3');
    if (projectsHeader) {
      projectsHeader.innerHTML = `Top Projects <span class="header-count-badge">Resume Req: ${data.totalDownloads || 0}</span>`;
    }
  };

  const renderList = (elementId, title, items, keyName) => {
    const card = document.getElementById(`card-${elementId}`);
    if (!card) return;

    if (!items || items.length === 0) {
      card.innerHTML = `<h3>${title}</h3><div class="empty-state"><span class="state-desc">No entries recorded.</span></div>`;
      return;
    }

    let html = `<h3>${title}</h3>`;
    items.forEach(item => {
      const val = item[keyName] || 'Unknown';
      html += `
        <div class="list-item">
          <span class="item-name" title="${val}">${val}</span>
          <span class="item-count">${item.count.toLocaleString()}</span>
        </div>
      `;
    });
    card.innerHTML = html;
  };

  // Fetch and Render Paginated Sessions list
  const loadSessionsList = async () => {
    try {
      let query = window.supabaseClient
        .from('visitor_sessions')
        .select(`
          *,
          page_views (page, title, visited_at)
        `, { count: 'exact' });

      // Apply Search filter
      if (searchTerm) {
        query = query.or(`country.ilike.%${searchTerm}%,city.ilike.%${searchTerm}%,browser.ilike.%${searchTerm}%,operating_system.ilike.%${searchTerm}%`);
      }

      // Apply Device filter
      if (deviceFilter !== 'all') {
        query = query.eq('device', deviceFilter);
      }

      // Range calculations
      const from = currentPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, count, error } = await query
        .order('started_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      totalSessionsCount = count || 0;
      activeSessions = data || [];

      renderRecentSessions();
      renderPaginationControls();
    } catch (err) {
      console.error('Error loading sessions:', err);
      showToast('Failed to load session details.', 'error');
    }
  };

  const renderRecentSessions = () => {
    const container = document.getElementById('recent-table-wrapper');
    if (!container) return;

    if (activeSessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="state-icon">📭</span>
          <div class="state-title">No matching sessions</div>
          <p class="state-desc">Try resetting your filters or search terms.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="recent-table">
        <thead>
          <tr>
            <th>Session ID</th>
            <th>Location</th>
            <th>Client Spec</th>
            <th>Current Page</th>
            <th>Duration / Scroll</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    activeSessions.forEach((s, idx) => {
      const returningTag = s.is_returning
        ? '<span class="text-returning">• Returning</span>'
        : '<span style="color:var(--muted); font-size:11px;">• New</span>';

      const location = s.city && s.country && s.city !== 'Unknown'
        ? `${s.city}, ${s.country}`
        : s.country || 'Unknown';

      const pvs = s.page_views || [];
      const pagePath = s.current_page || s.landing_page;
      const viewsCount = pvs.length;

      // Determine active / online status (last seen within 5 minutes)
      const lastSeenMs = s.last_seen ? new Date(s.last_seen).getTime() : 0;
      const isOnline = (Date.now() - lastSeenMs) < (5 * 60 * 1000) && !s.ended_at;

      const statusTag = isOnline
        ? '<span class="status-pill status-online">🟢 Active</span>'
        : '<span class="status-pill status-offline">⚪ Ended</span>';

      html += `
        <tr class="clickable-row" data-session-index="${idx}" title="Click to view full session timeline & metadata">
          <td>
            <div class="session-info">
              <span class="session-badge" style="font-family:var(--mono);">${s.session_id.substring(0, 8)}...</span>
              <span style="font-size:11.5px; color:var(--muted); font-family:var(--mono); margin-top:2px;">${formatTimeAgo(s.started_at)}</span>
            </div>
          </td>
          <td>
            <div style="font-weight:600; font-size:13.5px;">${location}</div>
            <div style="font-size:11px; font-family:var(--mono); color:var(--muted); margin-top:2px;">${s.timezone || 'Unknown'}</div>
          </td>
          <td>
            <div><strong>${s.device}</strong> ${returningTag}</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;" title="${s.user_agent}">${s.browser} (${s.operating_system})</div>
          </td>
          <td>
            <div class="session-pages">
              <strong style="color:var(--text); font-size:13px;">${pagePath}</strong>
              <span style="font-size:11px; color:var(--muted); display:block; margin-top:2px;" title="Path history: ${pvs.map(p => p.page).join(' → ')}">Views: ${viewsCount}</span>
            </div>
          </td>
          <td>
            <div style="font-weight:600; font-family:var(--mono); font-size:13px;">${formatDuration(s.visit_duration)}</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">Scroll: <strong>${Math.round(s.max_scroll_percentage)}%</strong></div>
          </td>
          <td>
            ${statusTag}
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Attach Click Event Handlers to rows to trigger Visitor Side Drawer
    container.querySelectorAll('tr.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        const index = parseInt(row.dataset.sessionIndex, 10);
        if (!isNaN(index) && activeSessions[index]) {
          openSessionDrawer(activeSessions[index]);
        }
      });
    });
  };

  // Sliding Visitor Detail Side Drawer Logic
  const openSessionDrawer = (session) => {
    const drawer = document.getElementById('session-drawer');
    const overlay = document.getElementById('session-drawer-overlay');
    const bodyContent = document.getElementById('drawer-body-content');
    const drawerSessionId = document.getElementById('drawer-session-id');
    const drawerVisitorTitle = document.getElementById('drawer-visitor-title');

    if (!drawer || !overlay || !bodyContent) return;

    drawerSessionId.textContent = `UUID: ${session.session_id.substring(0, 13)}...`;
    drawerVisitorTitle.textContent = `${session.city || 'Unknown'}, ${session.country || 'Unknown'}`;

    const pvs = session.page_views || [];
    const location = session.city && session.country ? `${session.city}, ${session.country}` : session.country || 'Unknown';
    const resolution = (session.screen_width && session.screen_height) ? `${session.screen_width} × ${session.screen_height}` : 'N/A';

    let timelineHtml = pvs.map(p => `
      <div class="timeline-item">
        <div class="timeline-time">${formatTimeAgo(p.visited_at)}</div>
        <div style="font-weight:600; color:var(--text); margin-top:2px;">${p.page}</div>
        <div style="font-size:11.5px; color:var(--muted);">${p.title || 'Page Visit'}</div>
      </div>
    `).join('');

    if (pvs.length === 0) {
      timelineHtml = `<div style="font-size:13px; color:var(--muted);">Landing on ${session.landing_page || '/'} recorded.</div>`;
    }

    bodyContent.innerHTML = `
      <div class="drawer-grid">
        <div class="drawer-info-card">
          <div class="drawer-info-label">Visitor ID</div>
          <div class="drawer-info-val" style="font-family:var(--mono); font-size:12px;">${session.visitor_id ? session.visitor_id.substring(0, 12) + '...' : 'Unknown'}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Returning Status</div>
          <div class="drawer-info-val">${session.is_returning ? '⚡ Returning Visitor' : '✨ First Visit'}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Location</div>
          <div class="drawer-info-val">${location}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Timezone</div>
          <div class="drawer-info-val">${session.timezone || 'Unknown'}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Device Type</div>
          <div class="drawer-info-val">${session.device || 'Desktop'}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Resolution</div>
          <div class="drawer-info-val">${resolution}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Browser</div>
          <div class="drawer-info-val">${session.browser || 'Unknown'}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Operating System</div>
          <div class="drawer-info-val">${session.operating_system || 'Unknown'}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Session Duration</div>
          <div class="drawer-info-val">${formatDuration(session.visit_duration)}</div>
        </div>
        <div class="drawer-info-card">
          <div class="drawer-info-label">Max Scroll Depth</div>
          <div class="drawer-info-val">${Math.round(session.max_scroll_percentage)}%</div>
        </div>
      </div>

      <div class="drawer-section-title">Session Navigation Timeline</div>
      <div class="timeline-list">
        ${timelineHtml}
      </div>

      <div class="drawer-section-title" style="margin-top:28px;">Technical Details</div>
      <div class="drawer-info-card" style="margin-bottom:12px;">
        <div class="drawer-info-label">Referrer Source</div>
        <div class="drawer-info-val" style="font-size:12px; font-family:var(--mono);">${session.referrer || 'Direct'}</div>
      </div>
      <div class="drawer-info-card">
        <div class="drawer-info-label">User Agent String</div>
        <div class="drawer-info-val" style="font-size:11px; font-family:var(--mono); color:var(--muted); line-height:1.4;">${session.user_agent || 'N/A'}</div>
      </div>
    `;

    drawer.classList.add('is-open');
    overlay.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
  };

  const closeSessionDrawer = () => {
    const drawer = document.getElementById('session-drawer');
    const overlay = document.getElementById('session-drawer-overlay');
    if (drawer) {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (overlay) {
      overlay.classList.remove('is-open');
    }
  };

  const renderPaginationControls = () => {
    const totalPages = Math.ceil(totalSessionsCount / PAGE_SIZE);
    const container = document.getElementById('pagination-container');
    if (!container) return;

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <button class="btn-admin" id="btn-prev-page" ${currentPage === 0 ? 'disabled' : ''}>← Previous</button>
      <span style="font-size:12.5px; color:var(--muted); font-family:var(--mono)">Page ${currentPage + 1} of ${totalPages} (${totalSessionsCount} total)</span>
      <button class="btn-admin" id="btn-next-page" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
    `;

    document.getElementById('btn-prev-page').addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        loadSessionsList();
      }
    });

    document.getElementById('btn-next-page').addEventListener('click', () => {
      if (currentPage < totalPages - 1) {
        currentPage++;
        loadSessionsList();
      }
    });
  };

  // Fetch and Render Recent Messages
  const loadRecentMessages = async () => {
    try {
      const { data, error } = await window.supabaseClient
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      renderMessages(data || []);
    } catch (err) {
      console.error('Error loading messages:', err);
      showToast('Failed to load contact messages.', 'error');
    }
  };

  const renderMessages = (messages) => {
    const container = document.getElementById('recent-messages-wrapper');
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="state-icon">✉️</span>
          <div class="state-title">No messages in inbox</div>
          <p class="state-desc">Your contact messages feed is currently empty.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="recent-table">
        <thead>
          <tr>
            <th>Sender Info</th>
            <th>Message Body</th>
            <th>Received</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    messages.forEach(m => {
      let badgeColor = 'rgba(255, 255, 255, 0.05)';
      if (m.status === 'unread') badgeColor = 'rgba(255, 87, 87, 0.15)';
      else if (m.status === 'read') badgeColor = 'rgba(77, 166, 255, 0.15)';
      else if (m.status === 'replied') badgeColor = 'rgba(184, 255, 60, 0.15)';

      const statusTag = `<span class="session-badge" style="background:${badgeColor}; color:var(--text); font-weight:600;">${m.status.toUpperCase()}</span>`;
      const encodedMsg = (m.message || '').replace(/"/g, '&quot;');
      const encodedName = (m.name || '').replace(/"/g, '&quot;');

      html += `
        <tr data-msg-id="${m.id}">
          <td>
            <div style="font-weight:600;">${m.name}</div>
            <div style="font-size:12px; color:var(--muted); font-family:var(--mono); margin-top:2px;">${m.email}</div>
          </td>
          <td style="max-width:300px; white-space:normal; word-break:break-word; line-height:1.45;">
            ${m.message}
          </td>
          <td style="font-size:12px; font-family:var(--mono); color:var(--muted);">${formatTimeAgo(m.created_at)}</td>
          <td>${statusTag}</td>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <a href="mailto:${m.email}?subject=Re:%20Portfolio%20Inquiry%20(${encodeURIComponent(m.name)})&body=${encodeURIComponent('\n\n--- Original Message from ' + m.name + ' ---\n' + m.message)}" 
                 class="btn-reply-email" 
                 title="Directly reply to ${m.name} via email" 
                 data-msg-id="${m.id}"
                 data-email="${m.email}"
                 data-name="${encodedName}"
                 data-msg="${encodedMsg}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>Reply</span>
              </a>

              <select class="btn-admin status-select" style="padding:4px 8px; font-size:12px;">
                <option value="unread" ${m.status === 'unread' ? 'selected' : ''}>Unread</option>
                <option value="read" ${m.status === 'read' ? 'selected' : ''}>Read</option>
                <option value="replied" ${m.status === 'replied' ? 'selected' : ''}>Replied</option>
              </select>
            </div>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Attach Reply click listener to update status in-place when native mailto link is clicked
    container.querySelectorAll('.btn-reply-email').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.msgId;
        const email = btn.dataset.email;

        // In-place UI update without destroying table DOM elements
        const row = btn.closest('tr');
        if (row) {
          const badge = row.querySelector('.session-badge');
          if (badge) {
            badge.style.background = 'rgba(184, 255, 60, 0.15)';
            badge.textContent = 'REPLIED';
          }
          const select = row.querySelector('.status-select');
          if (select) select.value = 'replied';
        }

        // Persist status update to database in background
        if (id) {
          try {
            await window.supabaseClient
              .from('contact_messages')
              .update({ status: 'replied' })
              .eq('id', id);
            showToast(`Opening email draft for ${email}...`, 'success');
          } catch (err) {
            console.error('Failed to update message status:', err);
          }
        }
      });
    });

    // Attach status toggle event listeners
    container.querySelectorAll('.status-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const row = e.target.closest('tr');
        const id = row.dataset.msgId;
        const nextStatus = e.target.value;

        try {
          const { error } = await window.supabaseClient
            .from('contact_messages')
            .update({ status: nextStatus })
            .eq('id', id);

          if (error) throw error;
          showToast(`Message marked as ${nextStatus}.`, 'success');
          loadRecentMessages();
        } catch (err) {
          console.error('Failed to update message status:', err);
          showToast('Failed to update message status.', 'error');
        }
      });
    });
  };

  // Load and Render Charts (Daily, Weekly, Monthly) using Chart.js
  const loadChartData = async () => {
    try {
      let viewName = 'daily_visitors_view';
      let dateKey = 'date';
      let limit = 30;

      if (currentChartType === 'weekly') {
        viewName = 'weekly_visitors_view';
        dateKey = 'week';
        limit = 12;
      } else if (currentChartType === 'monthly') {
        viewName = 'monthly_visitors_view';
        dateKey = 'month';
        limit = 12;
      }

      const { data, error } = await window.supabaseClient
        .from(viewName)
        .select('*')
        .limit(limit);

      if (error) throw error;

      // Map values
      const labels = [];
      const visitorsData = [];
      const sessionsData = [];

      (data || []).forEach(row => {
        labels.push(formatChartDate(row[dateKey], currentChartType));
        visitorsData.push(row.visitors);
        sessionsData.push(row.sessions);
      });

      renderChart(labels, visitorsData, sessionsData);
    } catch (err) {
      console.error('Error loading chart views:', err);
    }
  };

  const formatChartDate = (dateString, type) => {
    const d = new Date(dateString);
    if (type === 'daily') {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (type === 'weekly') {
      return `Wk ${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
    } else {
      return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
  };

  const renderChart = (labels, visitors, sessions) => {
    const ctx = document.getElementById('visitorsChart');
    if (!ctx) return;

    if (visitorsChart) {
      visitorsChart.destroy();
    }

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const accentColor = isLight ? '#388e3c' : '#b8ff3c';
    const secondaryColor = isLight ? '#0284c7' : '#4da6ff';
    const textColor = isLight ? '#0f172a' : '#ededed';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)';

    // Build gradient fill for Vercel-style chart rendering
    const chartCtx = ctx.getContext('2d');
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 300);
    if (isLight) {
      gradient.addColorStop(0, 'rgba(56, 142, 60, 0.2)');
      gradient.addColorStop(1, 'rgba(56, 142, 60, 0.0)');
    } else {
      gradient.addColorStop(0, 'rgba(184, 255, 60, 0.25)');
      gradient.addColorStop(1, 'rgba(184, 255, 60, 0.0)');
    }

    visitorsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Unique Visitors',
            data: visitors,
            borderColor: accentColor,
            backgroundColor: gradient,
            fill: true,
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: 3.5,
            pointHoverRadius: 6,
            pointBackgroundColor: accentColor
          },
          {
            label: 'Total Sessions',
            data: sessions,
            borderColor: secondaryColor,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [4, 4],
            tension: 0.35,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(15, 15, 20, 0.95)',
            titleFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' },
            bodyFont: { family: 'DM Sans', size: 12 },
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 }, precision: 0 }
          }
        }
      }
    });

    // Apply dataset visibility according to toggle button states
    document.querySelectorAll('.btn-metric-toggle').forEach(btn => {
      const idx = parseInt(btn.dataset.dataset, 10);
      const isActive = btn.classList.contains('active');
      if (visitorsChart && !isActive) {
        visitorsChart.setDatasetVisibility(idx, false);
      }
    });
    visitorsChart.update();
  };

  // Real-time Database Listeners for Dashboard updates
  const initRealtimeChannel = () => {
    if (!window.supabaseClient) return;
    if (realtimeChannel) return; // Prevent subscribing twice to the same channel instance

    realtimeChannel = window.supabaseClient
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'contact_messages' },
        (payload) => {
          showToast(`New message from ${payload.new.name}!`, 'success');
          loadRecentMessages();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'visitor_sessions' },
        () => {
          loadKpiSummary();
          loadSessionsList();
          loadChartData();
        }
      )
      .subscribe();
  };

  // Load Dashboard pipeline
  const loadDashboardData = () => {
    showLoadingSkeletons();
    
    // Fetch dashboard components
    if (window.supabaseClient) {
      loadKpiSummary();
      loadSessionsList();
      loadRecentMessages();
      loadChartData();
      initRealtimeChannel();
    } else {
      showToast('Supabase client not initialized.', 'error');
    }
  };

  // Setup Event Handlers
  const setupEventListeners = () => {
    // Auth login trigger (Form submit and button click)
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleLogin();
      });
    }

    const loginSubmitBtn = document.getElementById('btn-login-submit');
    if (loginSubmitBtn) {
      loginSubmitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogin();
      });
    }
    
    // Theme Toggle Handler
    const themeBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;

    const syncThemeUI = () => {
      const isLight = root.getAttribute('data-theme') === 'light';
      if (themeBtn) {
        themeBtn.textContent = isLight ? '☀️' : '🌙';
      }
    };

    syncThemeUI();

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const isLight = root.getAttribute('data-theme') === 'light';
        if (isLight) {
          root.removeAttribute('data-theme');
          localStorage.setItem('theme', 'dark');
        } else {
          root.setAttribute('data-theme', 'light');
          localStorage.setItem('theme', 'light');
        }
        syncThemeUI();
        loadChartData();
      });
    }

    // Auth logout trigger
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    // Refresh dashboard data with spin icon animation
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        const svg = refreshBtn.querySelector('svg');
        if (svg) svg.style.transform = 'rotate(360deg)';
        loadDashboardData();
        showToast('Refreshed all metrics.', 'info');
        setTimeout(() => { if (svg) svg.style.transform = ''; }, 600);
      });
    }

    // Chart metric line visibility toggles
    document.querySelectorAll('.btn-metric-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const toggleBtn = e.currentTarget;
        const datasetIndex = parseInt(toggleBtn.dataset.dataset, 10);

        toggleBtn.classList.toggle('active');
        const isActive = toggleBtn.classList.contains('active');

        if (visitorsChart) {
          visitorsChart.setDatasetVisibility(datasetIndex, isActive);
          visitorsChart.update();
        }
      });
    });

    // Chart toggle tabs
    document.querySelectorAll('.chart-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentChartType = e.target.dataset.type;
        loadChartData();
      });
    });

    // Search and Filters
    const searchInput = document.getElementById('search-visitor');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.trim();
        currentPage = 0; // reset page
        loadSessionsList();
      });
    }

    const filterSelect = document.getElementById('filter-device');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        deviceFilter = e.target.value;
        currentPage = 0; // reset page
        loadSessionsList();
      });
    }

    // Side Drawer Close triggers
    const closeDrawerBtn = document.getElementById('close-drawer-btn');
    const drawerOverlay = document.getElementById('session-drawer-overlay');

    if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeSessionDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener('click', closeSessionDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSessionDrawer();
    });
  };

  // Entry Point
  const bootstrap = () => {
    setupEventListeners();
    checkAuth();
  };

  // Wait for document and global supabase client
  if (document.readyState === 'complete') {
    bootstrap();
  } else {
    window.addEventListener('load', bootstrap);
  }
})();
