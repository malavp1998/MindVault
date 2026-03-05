const API_BASE = "https://mindvault-wspy.onrender.com"

// ── TOKEN MANAGEMENT ──────────────────────────────────

async function getToken() {
    return new Promise(resolve => {
        chrome.storage.local.get(["mv_token"], result => {
            resolve(result.mv_token || null)
        })
    })
}

async function getUser() {
    return new Promise(resolve => {
        chrome.storage.local.get(["mv_user"], result => {
            try {
                resolve(result.mv_user ? JSON.parse(result.mv_user) : null)
            } catch {
                resolve(null)
            }
        })
    })
}

async function saveToken(token, user) {
    return new Promise(resolve => {
        chrome.storage.local.set({
            mv_token: token,
            mv_user: JSON.stringify(user)
        }, resolve)
    })
}

async function clearToken() {
    return new Promise(resolve => {
        chrome.storage.local.remove(["mv_token", "mv_user"], resolve)
    })
}

// ── API CLIENT ────────────────────────────────────────

async function apiCall(endpoint, options = {}) {
    const token = await getToken()

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    })

    if (response.status === 401) {
        // token expired or invalid — clear it
        await clearToken()
        return { error: "unauthorized", status: 401 }
    }

    const data = await response.json()
    return { data, status: response.status, ok: response.ok }
}

// ── AUTH ──────────────────────────────────────────────

async function login(username, password) {
    const result = await apiCall("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
    })

    if (result.ok) {
        await saveToken(result.data.access_token, result.data.user)
        return { success: true, user: result.data.user }
    }

    return { success: false, error: result.data?.detail || "Login failed" }
}

async function logout() {
    await clearToken()
    return { success: true }
}

async function checkAuth() {
    const token = await getToken()
    if (!token) return { authenticated: false }

    const result = await apiCall("/auth/me")
    if (result.ok) {
        return { authenticated: true, user: result.data }
    }

    await clearToken()
    return { authenticated: false }
}

// ── NOTES ─────────────────────────────────────────────

async function saveNote(content, title, sourceUrl, annotation, userTags) {
    const finalContent = annotation
        ? `${annotation}\n\n${content}`
        : content

    return await apiCall("/api/notes", {
        method: "POST",
        body: JSON.stringify({
            content: finalContent,
            title: title,
            source_url: sourceUrl,
            user_tags: userTags || []
        })
    })
}

async function getRelatedNotes(url, content) {
    const params = new URLSearchParams()
    if (url) params.append("url", url)
    if (content) params.append("content", content.slice(0, 500))

    return await apiCall(`/api/notes/related?${params.toString()}`)
}

async function summarizeYoutube(videoUrl, annotation, transcript, title) {
    return await apiCall("/api/notes/youtube", {
        method: "POST",
        body: JSON.stringify({
            video_url: videoUrl,
            annotation: annotation || "",
            transcript: transcript || "",
            title: title || ""
        })
    })
}

async function searchVault(query) {
    return await apiCall(
        `/api/notes/search?q=${encodeURIComponent(query)}&synthesize=true`
    )
}

// ── MESSAGE HANDLER ───────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // must return true to keep channel open for async response
    handleMessage(message).then(sendResponse)
    return true
})

async function handleMessage(message) {
    switch (message.type) {

        case "CHECK_AUTH":
            return await checkAuth()

        case "LOGIN":
            return await login(message.username, message.password)

        case "LOGOUT":
            return await logout()

        case "SAVE_NOTE":
            return await saveNote(
                message.content,
                message.title,
                message.sourceUrl,
                message.annotation,
                message.userTags
            )

        case "GET_RELATED":
            return await getRelatedNotes(message.url, message.content)

        case "SUMMARIZE_YOUTUBE": {
            // Step 1 — Extract transcript client-side
            let transcript = null
            let warning = null
            let method = null

            try {
                const [tab] = await chrome.tabs.query({
                    active: true, currentWindow: true
                })

                // First try executing in MAIN world to access window.ytInitialPlayerResponse
                try {
                    const results = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        world: "MAIN",
                        func: async () => {
                            try {
                                const pr = window.ytInitialPlayerResponse ||
                                    document.querySelector("#movie_player")?.getPlayerResponse?.()
                                const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
                                if (!tracks || tracks.length === 0) return null

                                const track = tracks.find(t => t.kind !== "asr") || tracks[0]
                                const url = track.baseUrl + (track.baseUrl.includes("?") ? "&" : "?") + "fmt=json3"

                                const res = await fetch(url)
                                const data = await res.json()
                                return {
                                    transcript: (data.events || [])
                                        .filter(e => e.segs)
                                        .map(e => e.segs.map(s => s.utf8).join(""))
                                        .join(" ")
                                        .replace(/\n/g, " ")
                                        .trim(),
                                    method: "main_world_player_response"
                                }
                            } catch {
                                return null
                            }
                        }
                    })

                    if (results && results[0]?.result?.transcript) {
                        transcript = results[0].result.transcript
                        method = results[0].result.method
                    }
                } catch (e) {
                    console.log("[MindVault] MAIN world extraction failed:", e)
                }

                // If MAIN world failed, fallback to content script (ISOLATED world)
                if (!transcript) {
                    const contentScriptResult = await new Promise((resolve) => {
                        chrome.tabs.sendMessage(
                            tab.id,
                            { type: "GET_YOUTUBE_TRANSCRIPT" },
                            resolve
                        )
                    })

                    if (contentScriptResult && contentScriptResult.transcript) {
                        transcript = contentScriptResult.transcript
                        method = contentScriptResult.method
                        warning = contentScriptResult.warning
                    }
                }

            } catch (e) {
                console.error("[MindVault] Transcript extraction failed:", e)
            }

            if (!transcript) {
                return {
                    ok: false,
                    error: "Could not extract transcript from this video. The video may not have captions available."
                }
            }

            // Step 2 — Send transcript to backend for summarization only
            return await apiCall("/api/notes/youtube-summarize", {
                method: "POST",
                body: JSON.stringify({
                    transcript: transcript,
                    video_url: message.videoUrl,
                    video_title: message.videoTitle || "YouTube Video",
                    annotation: message.annotation || "",
                    extraction_method: method || "unknown",
                    warning: warning || ""
                })
            })
        }

        case "SEARCH_VAULT":
            return await searchVault(message.query)

        case "GET_USER":
            const user = await getUser()
            return { user }

        default:
            return { error: "Unknown message type" }
    }
}
