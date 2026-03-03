/**
 * MindVault Content Script
 * Injects floating button and sidebar into every webpage.
 * Uses Readability.js to extract clean page content.
 */

(function () {
  'use strict';

  const API_BASE = 'http://localhost:8000/api';

  // ─── Token Helper ───────────────────────────────────────────
  async function getToken() {
    return new Promise(resolve => {
      chrome.storage.local.get(['mv_token'], result => {
        resolve(result.mv_token || null);
      });
    });
  }

  async function authHeaders() {
    const token = await getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  // ─── Floating Action Button ──────────────────────────────────
  const fab = document.createElement('button');
  fab.id = 'mindvault-fab';
  fab.title = 'MindVault';
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  `;
  document.body.appendChild(fab);

  // ─── Sidebar Container ───────────────────────────────────────
  const container = document.createElement('div');
  container.id = 'mindvault-sidebar-container';
  container.innerHTML = `
    <div id="mindvault-sidebar">
      <div class="mv-header">
        <h1>🧠 MindVault</h1>
        <button class="mv-close-btn" id="mv-close">&times;</button>
      </div>

      <div class="mv-tabs">
        <button class="mv-tab active" data-tab="save">💾 Save</button>
        <button class="mv-tab" data-tab="notes">📝 My Notes</button>
      </div>

      <div class="mv-tab-content">
        <!-- Save Tab -->
        <div class="mv-tab-panel active" id="mv-panel-save">
          <div class="mv-page-info">
            <div class="mv-page-title" id="mv-page-title">Loading...</div>
            <div class="mv-page-url" id="mv-page-url"></div>
          </div>

          <label class="mv-label">Tags (comma-separated)</label>
          <input type="text" class="mv-input" id="mv-tags" placeholder="e.g. ai, ml, research">

          <label class="mv-label">Your Annotation</label>
          <textarea class="mv-textarea" id="mv-annotation" placeholder="Add your thoughts or notes about this page..."></textarea>

          <button class="mv-save-btn" id="mv-save-btn">
            💾 Save to Vault
          </button>

          <button class="mv-save-btn" id="mv-youtube-btn" style="display:none; margin-top: 10px; background-color: #cc0000;">
            📹 Summarize Video
          </button>

          <div id="mv-status" style="display:none;"></div>
        </div>

        <!-- Notes Tab -->
        <div class="mv-tab-panel" id="mv-panel-notes">
          <div class="mv-loading" id="mv-notes-loading" style="display:none;">
            <div class="mv-spinner"></div>
            <div>Finding related notes...</div>
          </div>
          <div id="mv-notes-list"></div>
          <div class="mv-empty" id="mv-notes-empty" style="display:none;">
            No related notes found yet. Save some pages first!
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  // ─── State ───────────────────────────────────────────────────
  let isOpen = false;
  let pageContent = '';
  let pageTitle = document.title;
  let pageUrl = window.location.href;

  // ─── Extract page content with Readability ───────────────────
  function extractContent() {
    try {
      if (typeof Readability !== 'undefined') {
        const docClone = document.cloneNode(true);
        const reader = new Readability(docClone);
        const article = reader.parse();
        if (article) {
          pageTitle = article.title || document.title;
          pageContent = article.textContent || '';
          return;
        }
      }
    } catch (e) {
      console.warn('MindVault: Readability failed, using fallback', e);
    }

    // Fallback: get selected text or body text
    const selection = window.getSelection().toString();
    if (selection.length > 50) {
      pageContent = selection;
    } else {
      pageContent = document.body.innerText.substring(0, 10000);
    }
  }

  // ─── Toggle Sidebar ─────────────────────────────────────────
  function toggleSidebar() {
    isOpen = !isOpen;
    container.classList.toggle('open', isOpen);

    if (isOpen) {
      extractContent();
      // Handle navigation changes in SPAs like YouTube
      pageUrl = window.location.href;
      document.getElementById('mv-page-title').textContent = pageTitle;
      document.getElementById('mv-page-url').textContent = pageUrl;

      const isYouTubeWatch = pageUrl.includes('youtube.com/watch');
      const ytBtn = document.getElementById('mv-youtube-btn');
      if (isYouTubeWatch) {
        ytBtn.style.display = 'block';
      } else {
        ytBtn.style.display = 'none';
      }
    }
  }

  fab.addEventListener('click', toggleSidebar);
  document.getElementById('mv-close').addEventListener('click', toggleSidebar);

  // Listen for extension icon clicks from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggle_sidebar') {
      toggleSidebar();
      sendResponse({ success: true });
    }
  });

  // ─── Tabs ────────────────────────────────────────────────────
  document.querySelectorAll('.mv-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Update tab buttons
      document.querySelectorAll('.mv-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update panels
      document.querySelectorAll('.mv-tab-panel').forEach(p => p.classList.remove('active'));
      const panelId = `mv-panel-${tab.dataset.tab}`;
      document.getElementById(panelId).classList.add('active');

      // Load related notes when switching to notes tab
      if (tab.dataset.tab === 'notes') {
        loadRelatedNotes();
      }
    });
  });

  // ─── Save Note ───────────────────────────────────────────────
  document.getElementById('mv-save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('mv-save-btn');
    const status = document.getElementById('mv-status');
    const tags = document.getElementById('mv-tags').value;
    const annotation = document.getElementById('mv-annotation').value;

    btn.disabled = true;
    btn.textContent = '⏳ Saving...';

    try {
      const headers = await authHeaders();
      const response = await fetch(`${API_BASE}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: pageTitle,
          content: pageContent.substring(0, 50000),
          source_url: pageUrl,
          tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          annotation: annotation || null,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      status.className = 'mv-status success';
      status.textContent = '✅ Saved to vault! AI processing started.';
      status.style.display = 'block';

      btn.textContent = '✅ Saved!';
      setTimeout(() => {
        btn.textContent = '💾 Save to Vault';
        btn.disabled = false;
      }, 3000);
    } catch (err) {
      status.className = 'mv-status error';
      status.textContent = `❌ Failed: ${err.message}`;
      status.style.display = 'block';
      btn.textContent = '💾 Save to Vault';
      btn.disabled = false;
    }
  });

  // ─── YouTube Summarize ─────────────────────────────────────────
  document.getElementById('mv-youtube-btn').addEventListener('click', () => {
    const btn = document.getElementById('mv-youtube-btn');
    const status = document.getElementById('mv-status');
    const annotation = document.getElementById('mv-annotation').value;

    // Update local variable just in case
    pageUrl = window.location.href;

    btn.disabled = true;
    btn.textContent = '⏳ Fetching Transcript & Summarizing...';

    // Send to background.js to bypass content script CORS/restrictions if any
    chrome.runtime.sendMessage(
      { action: 'summarize_youtube', data: { video_url: pageUrl, annotation: annotation || null } },
      (response) => {
        if (!response || !response.success) {
          status.className = 'mv-status error';
          status.textContent = `❌ Failed: ${response ? response.error : 'Unknown error'}`;
          status.style.display = 'block';
          btn.textContent = '📹 Summarize Video';
          btn.disabled = false;
        } else {
          status.className = 'mv-status success';
          status.textContent = '✅ Saved to vault! AI processing started.';
          status.style.display = 'block';

          btn.textContent = '✅ Saved!';
          setTimeout(() => {
            btn.textContent = '📹 Summarize Video';
            btn.disabled = false;
          }, 3000);
        }
      }
    );
  });

  // ─── Load Related Notes ──────────────────────────────────────
  async function loadRelatedNotes() {
    const loading = document.getElementById('mv-notes-loading');
    const list = document.getElementById('mv-notes-list');
    const empty = document.getElementById('mv-notes-empty');

    loading.style.display = 'block';
    list.innerHTML = '';
    empty.style.display = 'none';

    try {
      // Try by URL first, then by content
      let url = `${API_BASE}/notes/related?url=${encodeURIComponent(pageUrl)}&top_k=5`;
      const headers = await authHeaders();
      const response = await fetch(url, { headers });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      loading.style.display = 'none';

      if (!data.notes || data.notes.length === 0) {
        // Try content-based search
        const contentResponse = await fetch(
          `${API_BASE}/notes/related?content=${encodeURIComponent(pageTitle + ' ' + pageContent.substring(0, 500))}&top_k=5`,
          { headers: await authHeaders() }
        );
        if (contentResponse.ok) {
          const contentData = await contentResponse.json();
          if (contentData.notes && contentData.notes.length > 0) {
            renderNotes(contentData.notes);
            return;
          }
        }
        empty.style.display = 'block';
        return;
      }

      renderNotes(data.notes);
    } catch (err) {
      loading.style.display = 'none';
      list.innerHTML = `<div class="mv-status error">Failed to load notes: ${err.message}</div>`;
    }
  }

  function renderNotes(notes) {
    const list = document.getElementById('mv-notes-list');
    list.innerHTML = notes.map(item => {
      let tagsHtml = '';

      if (item.note.auto_tags && item.note.auto_tags.length > 0) {
        tagsHtml += item.note.auto_tags.slice(0, 3).map(t =>
          `<span class="mv-tag mv-auto-tag">✨ ${escapeHtml(t)}</span>`
        ).join('');
      }

      if (item.note.user_tags && item.note.user_tags.length > 0) {
        tagsHtml += item.note.user_tags.slice(0, 3).map(t =>
          `<span class="mv-tag mv-user-tag">🏷️ ${escapeHtml(t)}</span>`
        ).join('');
      } else if (item.note.tags && item.note.tags.length > 0 && (!item.note.auto_tags || item.note.auto_tags.length === 0)) {
        // Fallback for legacy tags
        tagsHtml += item.note.tags.slice(0, 3).map(t =>
          `<span class="mv-tag">${escapeHtml(t)}</span>`
        ).join('');
      }

      return `
      <div class="mv-note-card" onclick="window.open('http://localhost:5173/note/${item.note.id}', '_blank')">
        <div class="mv-note-card-title">${escapeHtml(item.note.title)}</div>
        ${tagsHtml ? `<div class="mv-note-card-tags">${tagsHtml}</div>` : ''}
        ${item.note.summary ? `<div class="mv-note-card-summary">${escapeHtml(item.note.summary)}</div>` : ''}
        <div class="mv-note-card-meta">
          <span>${new Date(item.note.created_at).toLocaleDateString()}</span>
          <span class="mv-similarity-badge">${(item.similarity * 100).toFixed(0)}% match</span>
        </div>
      </div>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
