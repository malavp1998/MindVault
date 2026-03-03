/**
 * MindVault Background Service Worker
 * Handles extension action clicks, API communication, and auth token management.
 */

const API_BASE = 'http://localhost:8000/api';
const AUTH_BASE = 'http://localhost:8000/auth';

// ─── Token Management ────────────────────────────────────────

async function getToken() {
    return new Promise(resolve => {
        chrome.storage.local.get(['mv_token'], result => {
            resolve(result.mv_token || null);
        });
    });
}

async function saveToken(token) {
    return new Promise(resolve => {
        chrome.storage.local.set({ mv_token: token }, resolve);
    });
}

async function removeToken() {
    return new Promise(resolve => {
        chrome.storage.local.remove(['mv_token'], resolve);
    });
}

// Authenticated API call helper — attaches JWT header automatically
async function apiCall(endpoint, options = {}) {
    const token = await getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    // If token expired, broadcast to content scripts
    if (response.status === 401) {
        await removeToken();
        // Notify all tabs that auth is invalid
        chrome.runtime.sendMessage({ action: 'auth_expired' });
    }

    return response;
}

// ─── Auth Endpoints (no token needed) ────────────────────────

async function sendOTP(phoneNumber) {
    const response = await fetch(`${AUTH_BASE}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber }),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${response.status}`);
    }
    return response.json();
}

async function verifyOTP(phoneNumber, otpCode) {
    const response = await fetch(`${AUTH_BASE}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber, otp_code: otpCode }),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${response.status}`);
    }
    const data = await response.json();
    // Save token on successful verification
    await saveToken(data.access_token);
    return data;
}

// Toggle sidebar when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'toggle_sidebar' });
    } catch (err) {
        // Content script might not be loaded yet
        console.warn('MindVault: Could not send message to tab', err);
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'save_note') {
        saveNote(message.data)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Keep channel open for async response
    }

    if (message.action === 'get_related') {
        getRelatedNotes(message.url, message.content)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.action === 'summarize_youtube') {
        summarizeYouTube(message.data)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // Auth messages from content script login UI
    if (message.action === 'auth_send_otp') {
        sendOTP(message.phone_number)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.action === 'auth_verify_otp') {
        verifyOTP(message.phone_number, message.otp_code)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.action === 'auth_check') {
        getToken().then(token => sendResponse({ has_token: !!token }));
        return true;
    }

    if (message.action === 'auth_logout') {
        removeToken().then(() => sendResponse({ success: true }));
        return true;
    }
});

async function saveNote(data) {
    const response = await apiCall('/notes', {
        method: 'POST',
        body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function getRelatedNotes(url, content) {
    const params = new URLSearchParams();
    if (url) params.set('url', url);
    if (content) params.set('content', content.substring(0, 500));
    params.set('top_k', '5');

    const response = await apiCall(`/notes/related?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function summarizeYouTube(data) {
    const response = await apiCall('/notes/youtube', {
        method: 'POST',
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
    }
    return response.json();
}
