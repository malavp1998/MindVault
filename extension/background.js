/**
 * MindVault Background Service Worker
 * Handles extension action clicks and API communication.
 */

const API_BASE = 'http://localhost:8000/api';

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
});

async function saveNote(data) {
    const response = await fetch(`${API_BASE}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    const response = await fetch(`${API_BASE}/notes/related?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function summarizeYouTube(data) {
    const response = await fetch(`${API_BASE}/notes/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
    }
    return response.json();
}
