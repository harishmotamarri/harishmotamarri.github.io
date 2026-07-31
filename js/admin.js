/**
 * Visitor Analytics Admin Dashboard Module
 * Uses Supabase Auth, client-side RLS queries, and Chart.js
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
    loadDashboardData();
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
  const handleLogin = async () => {
    const emailField = document.getElementById('login-email');
    const passwordField = document.getElementById('login-password');
    const submitBtn = document.getElementById('btn-login-submit');

    const email = emailField.value.trim();
    const password = passwordField.value;

    if (!email || !password) {
      showToast('Please enter both email and password.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Authenticating...';

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
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Authenticate';
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
    document.getElementById('kpi-container').innerHTML = Array(6).fill(0).map(() => `
      <div class="admin-card kpi-card">
        <div class="kpi-title shimmer" style="width:50%; height:12px;"></div>
        <div class="kpi-value shimmer" style="width:80%; height:32px; margin-top:8px;"></div>
      </div>
    `).join('');

    const aggregateCards = ['countries', 'browsers', 'devices', 'pages', 'projects'];
    aggregateCards.forEach(c => {
      const el = document.getElementById(`card-${c}`);
      if (el) {
        el.innerHTML = `<h3>Top ${c.charAt(0).toUpperCase() + c.slice(1)}</h3>
          <div class="loading-list"><div class="shimmer"></div><div class="shimmer"></div><div class="shimmer"></div></div>`;
      }
    });

    document.getElementById('recent-table-wrapper').innerHTML = `
      <div class="shimmer" style="height: 40px; margin-bottom: 12px;"></div>
      <div class="shimmer" style="height: 60px; margin-bottom: 12px;"></div>
      <div class="shimmer" style="height: 60px; margin-bottom: 12px;"></div>
      <div class="shimmer" style="height: 60px;"></div>
    `;
    
    document.getElementById('recent-messages-wrapper').innerHTML = `
      <div class="shimmer" style="height: 40px; margin-bottom: 12px;"></div>
      <div class="shimmer" style="height: 80px; margin-bottom: 12px;"></div>
      <div class="shimmer" style="height: 80px;"></div>
    `;
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

    document.getElementById('kpi-container').innerHTML = `
      <div class="admin-card kpi-card">
        <div class="kpi-title">Total Visitors</div>
        <div class="kpi-value">${data.totalVisitors.toLocaleString()}</div>
      </div>
      <div class="admin-card kpi-card">
        <div class="kpi-title">Active (24h)</div>
        <div class="kpi-value">${data.todayVisitors.toLocaleString()}</div>
      </div>
      <div class="admin-card kpi-card">
        <div class="kpi-title">Weekly Active</div>
        <div class="kpi-value">${data.weekVisitors.toLocaleString()}</div>
      </div>
      <div class="admin-card kpi-card">
        <div class="kpi-title">Returning Rate</div>
        <div class="kpi-value">${data.returningVisitors.toLocaleString()} <span class="kpi-subtext">(${returningRate}%)</span></div>
      </div>
      <div class="admin-card kpi-card">
        <div class="kpi-title">Avg Session Duration</div>
        <div class="kpi-value">${formatDuration(Math.round(data.avgDuration))}</div>
      </div>
      <div class="admin-card kpi-card">
        <div class="kpi-title">Avg Scroll Depth</div>
        <div class="kpi-value">${Math.round(data.avgScroll)}%</div>
      </div>
    `;

    // Render Lists
    renderList('countries', 'Top Countries', data.topCountries, 'country');
    renderList('browsers', 'Top Browsers', data.topBrowsers, 'browser');
    renderList('devices', 'Top Devices', data.topDevices, 'device');
    renderList('pages', 'Top Pages', data.topPages, 'page');
    renderList('projects', 'Top Projects', data.topProjects, 'project_name');
    
    // Add total resume downloads to subtitle/info if needed
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
            <th>Session Info</th>
            <th>Location</th>
            <th>Client Info</th>
            <th>Current Page</th>
            <th>Duration / Scroll</th>
          </tr>
        </thead>
        <tbody>
    `;

    activeSessions.forEach(s => {
      const returningTag = s.is_returning
        ? '<span class="text-returning">• Returning</span>'
        : '<span style="color:var(--muted); font-size:11px;">• New</span>';

      const location = s.city && s.country && s.city !== 'Unknown'
        ? `${s.city}, ${s.country}`
        : s.country || 'Unknown';

      const pvs = s.page_views || [];
      const pagePath = s.current_page || s.landing_page;
      const viewsCount = pvs.length;

      html += `
        <tr>
          <td>
            <div class="session-info">
              <span class="session-badge" title="Session UUID: ${s.session_id}">${s.session_id.substring(0, 8)}...</span>
              <span style="font-size:12px; color:var(--muted); margin-top:2px;">${formatTimeAgo(s.started_at)}</span>
            </div>
          </td>
          <td>
            <div style="font-weight:500;">${location}</div>
            <div style="font-size:11px; font-family:var(--mono); color:var(--muted); margin-top:2px;">${s.timezone || 'Unknown'}</div>
          </td>
          <td>
            <div>${s.device} ${returningTag}</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;" title="${s.user_agent}">${s.browser} (${s.operating_system})</div>
          </td>
          <td>
            <div class="session-pages">
              <strong style="color:var(--text); font-size:13.5px;">${pagePath}</strong>
              <span style="font-size:11px; color:var(--muted); display:block; margin-top:2px;" title="Path history: ${pvs.map(p => p.page).join(' → ')}">Views: ${viewsCount}</span>
            </div>
          </td>
          <td>
            <div style="font-weight:600; font-family:var(--mono); font-size:13px;">${formatDuration(s.visit_duration)}</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">Scroll: <strong>${Math.round(s.max_scroll_percentage)}%</strong></div>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
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
      <button class="btn-admin" id="btn-prev-page" ${currentPage === 0 ? 'disabled' : ''}>Previous</button>
      <span style="font-size:13px; color:var(--muted); font-family:var(--mono)">Page ${currentPage + 1} of ${totalPages} (${totalSessionsCount} total)</span>
      <button class="btn-admin" id="btn-next-page" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
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
    if (messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="state-icon">✉️</span>
          <div class="state-title">No messages</div>
          <p class="state-desc">Your message box is currently empty.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="recent-table">
        <thead>
          <tr>
            <th>Sender</th>
            <th>Message</th>
            <th>Received</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    messages.forEach(m => {
      let badgeColor = 'rgba(255, 255, 255, 0.05)';
      if (m.status === 'unread') badgeColor = 'rgba(255, 87, 87, 0.1)';
      else if (m.status === 'read') badgeColor = 'rgba(77, 166, 255, 0.1)';
      else if (m.status === 'replied') badgeColor = 'rgba(184, 255, 60, 0.1)';

      const statusTag = `<span class="session-badge" style="background:${badgeColor}; color:var(--text);">${m.status}</span>`;

      html += `
        <tr data-msg-id="${m.id}">
          <td>
            <div style="font-weight:600;">${m.name}</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">${m.email}</div>
          </td>
          <td style="max-width:320px; white-space:normal; word-break:break-word; line-height:1.4;">
            ${m.message}
          </td>
          <td style="font-size:12.5px; color:var(--muted);">${formatTimeAgo(m.created_at)}</td>
          <td>${statusTag}</td>
          <td>
            <select class="btn-admin status-select" style="padding:4px 8px; font-size:12px;">
              <option value="unread" ${m.status === 'unread' ? 'selected' : ''}>Unread</option>
              <option value="read" ${m.status === 'read' ? 'selected' : ''}>Read</option>
              <option value="replied" ${m.status === 'replied' ? 'selected' : ''}>Replied</option>
            </select>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

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

      data.forEach(row => {
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

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b8ff3c';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ededed';
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(255,255,255,0.07)';

    visitorsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Unique Visitors',
            data: visitors,
            borderColor: accentColor,
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: accentColor
          },
          {
            label: 'Total Sessions',
            data: sessions,
            borderColor: '#4da6ff',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 5],
            tension: 0.3,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: textColor,
              font: { family: 'DM Sans', size: 12 }
            }
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
    if (loginSubmitBtn && !loginForm) {
      loginSubmitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogin();
      });
    }
    
    // Auth logout trigger
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    // Refresh dashboard data
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadDashboardData();
        showToast('Refreshed all metrics.', 'info');
      });
    }

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
