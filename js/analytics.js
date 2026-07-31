/**
 * Production-grade Serverless Visitor Analytics Tracker
 * Communicates directly with Supabase via Client SDK
 */
(function initAnalytics() {
  const visitorCacheKey = 'portfolio-visitor-uuid';
  const sessionCacheKey = 'portfolio-session-uuid';
  const HEARTBEAT_INTERVAL_MS = 15000;

  let maxScrollPercentage = 0;
  let heartbeatTimer = null;
  let sessionStarted = false;
  let isLeavingLogged = false;

  // Helper: UUID Generator with fallback
  const generateUUID = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const getVisitorId = () => {
    let id = localStorage.getItem(visitorCacheKey);
    if (!id) {
      id = generateUUID();
      localStorage.setItem(visitorCacheKey, id);
    }
    return id;
  };

  const getSessionId = () => {
    let id = sessionStorage.getItem(sessionCacheKey);
    if (!id) {
      id = generateUUID();
      sessionStorage.setItem(sessionCacheKey, id);
    }
    return id;
  };

  const visitorId = getVisitorId();
  const sessionId = getSessionId();

  // Helper: Calculate Scroll Percentage
  const getScrollPercentage = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    return scrollHeight > 0 ? Math.min(100, Math.round((scrollTop / scrollHeight) * 100)) : 0;
  };

  const trackScroll = () => {
    const currentScroll = getScrollPercentage();
    if (currentScroll > maxScrollPercentage) {
      maxScrollPercentage = currentScroll;
    }
  };

  // Scroll event throttler
  let scrollTimeout = null;
  window.addEventListener('scroll', () => {
    if (!scrollTimeout) {
      scrollTimeout = setTimeout(() => {
        trackScroll();
        scrollTimeout = null;
      }, 250);
    }
  });

  // Geolocation API fetch
  const getGeoLocation = async () => {
    try {
      const res = await fetch('https://ipapi.co/json/');
      if (res.ok) {
        const data = await res.json();
        return {
          country: data.country_name || 'Unknown',
          city: data.city || 'Unknown'
        };
      }
    } catch (err) {
      console.warn('Analytics Geolocation failed, using fallbacks:', err.message);
    }
    return { country: 'Unknown', city: 'Unknown' };
  };

  // Check if client is returning visitor
  const checkIsReturning = async () => {
    try {
      const { data, error } = await window.supabaseClient
        .from('visitor_sessions')
        .select('session_id')
        .eq('visitor_id', visitorId)
        .limit(1);

      if (error) throw error;
      return data && data.length > 0;
    } catch (err) {
      console.error('Analytics: Error checking returning status:', err);
      return false;
    }
  };

  // Initialize and write Session/Visit row
  const logVisit = async () => {
    if (sessionStarted) return;
    
    // Check if session already exists in DB to prevent duplicates on reload
    try {
      const { data: existing, error: checkError } = await window.supabaseClient
        .from('visitor_sessions')
        .select('session_id')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (existing) {
        sessionStarted = true;
        startHeartbeat();
        return;
      }
    } catch (e) {
      // Proceed if query failed
    }

    const isReturning = await checkIsReturning();
    const geo = await getGeoLocation();

    // Parse UA on client-side if UAParser is loaded, else use fallback
    let browser = 'Unknown';
    let os = 'Unknown';
    let device = 'Desktop';

    if (typeof UAParser !== 'undefined') {
      const parser = new UAParser();
      const res = parser.getResult();
      browser = res.browser.name ? `${res.browser.name} ${res.browser.version || ''}`.trim() : 'Unknown';
      os = res.os.name ? `${res.os.name} ${res.os.version || ''}`.trim() : 'Unknown';
      if (res.device.type === 'mobile') device = 'Mobile';
      else if (res.device.type === 'tablet') device = 'Tablet';
    }

    const currentPath = window.location.pathname + window.location.hash;

    const sessionPayload = {
      visitor_id: visitorId,
      session_id: sessionId,
      country: geo.country,
      city: geo.city,
      browser,
      operating_system: os,
      device,
      screen_width: window.innerWidth,
      screen_height: window.innerHeight,
      language: navigator.language || 'en',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
      landing_page: currentPath,
      current_page: currentPath,
      referrer: document.referrer || 'Direct',
      user_agent: navigator.userAgent,
      is_returning: isReturning,
      visit_duration: 0,
      max_scroll_percentage: maxScrollPercentage,
      started_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    try {
      const { error: sessionErr } = await window.supabaseClient
        .from('visitor_sessions')
        .insert([sessionPayload]);

      if (sessionErr) throw sessionErr;

      sessionStarted = true;

      // Log initial page view
      await window.supabaseClient
        .from('page_views')
        .insert([{
          session_id: sessionId,
          page: currentPath,
          title: document.title || 'Home',
          visited_at: new Date().toISOString()
        }]);

      startHeartbeat();
    } catch (err) {
      console.error('Analytics: Visit log failed:', err);
    }
  };

  // Log Page View
  const logPageView = async (path, title) => {
    if (!sessionStarted) return;
    const timestamp = new Date().toISOString();

    try {
      // Log Pageview and update session page/last_seen in parallel
      await Promise.all([
        window.supabaseClient
          .from('page_views')
          .insert([{
            session_id: sessionId,
            page: path,
            title: title || path,
            visited_at: timestamp
          }]),
        window.supabaseClient
          .from('visitor_sessions')
          .update({
            current_page: path,
            last_seen: timestamp,
            max_scroll_percentage: maxScrollPercentage,
            updated_at: timestamp
          })
          .eq('session_id', sessionId)
      ]);
    } catch (err) {
      console.error('Analytics: Pageview log failed:', err);
    }
  };

  // Heartbeat loop: batch updates duration and max scroll
  const sendHeartbeat = async () => {
    if (!sessionStarted) return;
    
    const timestamp = new Date().toISOString();
    const duration = Math.round((Date.now() - performance.timeOrigin) / 1000); // precise page duration

    try {
      await window.supabaseClient
        .from('visitor_sessions')
        .update({
          last_seen: timestamp,
          visit_duration: duration,
          max_scroll_percentage: maxScrollPercentage,
          updated_at: timestamp
        })
        .eq('session_id', sessionId);
    } catch (err) {
      console.error('Analytics: Heartbeat update failed:', err);
    }
  };

  const startHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  };

  // Track exits using beforeunload
  const logLeave = async () => {
    if (isLeavingLogged || !sessionStarted) return;
    isLeavingLogged = true;

    const timestamp = new Date().toISOString();
    const duration = Math.round((Date.now() - performance.timeOrigin) / 1000);

    // Note: Since we are direct serverless, we must perform an async fetch.
    // In serverless, we can use the supabase client but make it non-blocking.
    window.supabaseClient
      .from('visitor_sessions')
      .update({
        last_seen: timestamp,
        ended_at: timestamp,
        visit_duration: duration,
        max_scroll_percentage: maxScrollPercentage,
        updated_at: timestamp
      })
      .eq('session_id', sessionId)
      .then();
  };

  // Listen for navigation hash changes
  let lastHash = window.location.hash;
  window.addEventListener('hashchange', () => {
    if (window.location.hash !== lastHash) {
      lastHash = window.location.hash;
      logPageView(window.location.pathname + window.location.hash, document.title);
    }
  });

  // Track Project Clicks
  const initProjectClicksTracker = () => {
    // Select project cards once loaded
    const trackClicks = () => {
      document.querySelectorAll('.proj-card').forEach(card => {
        const summary = card.querySelector('.proj-summary');
        if (summary && !summary.dataset.tracked) {
          summary.dataset.tracked = 'true';
          summary.addEventListener('click', async () => {
            const titleEl = card.querySelector('.proj-title');
            const projectName = titleEl ? titleEl.textContent.trim() : 'Unknown Project';

            try {
              await window.supabaseClient
                .from('project_clicks')
                .insert([{
                  session_id: sessionId,
                  project_name: projectName,
                  clicked_at: new Date().toISOString()
                }]);
            } catch (err) {
              console.error('Analytics: Project click tracking failed:', err);
            }
          });
        }
      });
    };

    // Run immediately and set mutation observer in case grid updates dynamically
    trackClicks();
    const observer = new MutationObserver(trackClicks);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  // Track Resume Downloads
  const initResumeTracker = () => {
    document.body.addEventListener('click', async (e) => {
      const target = e.target.closest('a, button');
      if (!target) return;

      const href = target.getAttribute('href') || '';
      const text = target.textContent || '';

      const isResumeClick = 
        href.includes('Request%20for%20Resume') || 
        text.includes('Request Resume') || 
        target.classList.contains('nav-resume') || 
        target.classList.contains('btn-resume');

      if (isResumeClick) {
        try {
          await window.supabaseClient
            .from('resume_downloads')
            .insert([{
              session_id: sessionId,
              downloaded_at: new Date().toISOString()
            }]);
        } catch (err) {
          console.error('Analytics: Resume download logging failed:', err);
        }
      }
    });
  };

  // Handle Toast helper locally
  const showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" aria-label="Close">&times;</button>
    `;
    container.appendChild(toast);
    
    // Trigger reflow & show
    toast.offsetHeight;
    toast.classList.add('show');

    const closeToast = () => {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', () => toast.remove());
    };
    setTimeout(closeToast, 4000);
    toast.querySelector('.toast-close').addEventListener('click', closeToast);
  };

  // Intercept Contact Form Submissions
  const initContactFormTracker = () => {
    const form = document.getElementById('contact-mail-form');
    if (!form) return;

    // Remove existing submit listeners by cloning
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const nameField = document.getElementById('contact-name');
      const emailField = document.getElementById('contact-email');
      const aboutField = document.getElementById('contact-about');
      const submitBtn = newForm.querySelector('.contact-submit');

      const name = nameField ? nameField.value.trim() : '';
      const email = emailField ? emailField.value.trim() : '';
      const message = aboutField ? aboutField.value.trim() : '';

      if (!name || !email || !message) {
        showToast('Please fill in all fields.', 'error');
        return;
      }

      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '⌛ Sending...';

      try {
        const { error } = await window.supabaseClient
          .from('contact_messages')
          .insert([{ name, email, message, status: 'unread' }]);

        if (error) throw error;

        showToast('Message sent successfully! Thank you.', 'success');
        nameField.value = '';
        emailField.value = '';
        aboutField.value = '';
      } catch (err) {
        console.error('Analytics: Contact message write failed:', err);
        showToast('Failed to send message. Please try again.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });
  };

  // Bootstrap
  const init = async () => {
    // 1. Log Session visit
    await logVisit();
    // 2. Setup project click event hooks
    initProjectClicksTracker();
    // 3. Setup resume downloads click hooks
    initResumeTracker();
    // 4. Setup contact form intercept hooks
    initContactFormTracker();
  };

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  // Hook pagehide/leave events (unload is deprecated and blocked by browser permissions policy)
  window.addEventListener('beforeunload', logLeave);
  window.addEventListener('pagehide', logLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') logLeave();
  });
})();
