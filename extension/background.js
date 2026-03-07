const API_BASE = "https://mindvault-wspy.onrender.com"
const WEB_APP_URL = "https://mind-vault-ecru.vercel.app"

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
            } catch { resolve(null) }
        })
    })
}

async function saveTokenAndUser(token, user) {
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

// ── Try to get a fresh Firebase token from an open web app tab ───────────
// The web app tab runs React + Firebase SDK, so it can call
// auth.currentUser.getIdToken(true) to get a fresh token.
// We inject a tiny script into the tab that reads from window.__mv_fresh_token
// which AuthContext sets on the window object.

async function tryRefreshTokenFromWebApp() {
    try {
        const tabs = await chrome.tabs.query({ url: WEB_APP_URL + "/*" })
        if (!tabs.length) return null

        const tab = tabs[0]
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                return window.__mv_fresh_token || null
            }
        })

        const freshToken = results?.[0]?.result
        return freshToken || null
    } catch {
        return null
    }
}

// ── API CLIENT ────────────────────────────────────────

async function apiCall(endpoint, options = {}, token = null) {
    const authToken = token || await getToken()

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            ...(options.headers || {})
        }
    })

    if (response.status === 401) {
        return { error: "unauthorized", status: 401 }
    }

    const data = await response.json()
    return { data, status: response.status, ok: response.ok }
}

// ── AUTH ──────────────────────────────────────────────

// No login() function needed — token is set by the web app via Firebase.
// Extension just reads the token from chrome.storage.local.

async function checkAuth() {
    const token = await getToken()
    if (!token) return { authenticated: false }

    // First attempt with stored token
    const result = await apiCall("/auth/me", {}, token)

    if (result.ok) {
        await saveTokenAndUser(token, result.data)
        return { authenticated: true, user: result.data }
    }

    // Token stale (401) — try to get a fresh one from open web app tab
    if (result.status === 401) {
        const freshToken = await tryRefreshTokenFromWebApp()

        if (freshToken) {
            const retryResult = await apiCall("/auth/me", {}, freshToken)
            if (retryResult.ok) {
                await saveTokenAndUser(freshToken, retryResult.data)
                return { authenticated: true, user: retryResult.data }
            }
        }

        // Truly expired — clear and ask user to re-login
        await clearToken()
        return { authenticated: false }
    }

    return { authenticated: false }
}

async function logout() {
    await clearToken()
    return { success: true }
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
            const [tab] = await chrome.tabs.query({
                active: true, currentWindow: true
            })

            let transcriptResult = null
            const videoUrl = message.videoUrl || ""
            const isShorts = videoUrl.includes("/shorts/")
            let originalUrl = null

            // ── SHORTS URL CONVERSION ─────────────────────────────
            // Convert /shorts/VIDEO_ID → /watch?v=VIDEO_ID so the
            // regular video page loads with transcript panel UI
            if (isShorts) {
                const shortsMatch = videoUrl.match(/\/shorts\/([a-zA-Z0-9_-]+)/)
                if (shortsMatch) {
                    originalUrl = videoUrl
                    const watchUrl = `https://www.youtube.com/watch?v=${shortsMatch[1]}`
                    console.log("[MindVault] Converting Shorts URL:", originalUrl, "→", watchUrl)

                    // Navigate the tab to the regular watch page
                    await chrome.tabs.update(tab.id, { url: watchUrl })

                    // Wait for the page to fully load
                    await new Promise(resolve => {
                        const onComplete = (tabId, changeInfo) => {
                            if (tabId === tab.id && changeInfo.status === "complete") {
                                chrome.tabs.onUpdated.removeListener(onComplete)
                                resolve()
                            }
                        }
                        chrome.tabs.onUpdated.addListener(onComplete)
                    })

                    // Extra wait for YouTube SPA to render DOM elements
                    await new Promise(r => setTimeout(r, 2000))
                }
            }

            // ── DOM SCRAPE — works on regular video page ──────────
            try {
                const result = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    world: "ISOLATED",
                    func: async () => {

                        const sleep = ms => new Promise(r => setTimeout(r, ms))

                        // ── STEP 1 — check if transcript panel already open ──
                        const getSegments = () => document.querySelectorAll(
                            "ytd-transcript-segment-renderer .segment-text"
                        )

                        // ── STEP 2 — open transcript panel ───────────────────
                        if (getSegments().length === 0) {

                            // first expand the description "...more" section
                            const showMoreBtn = document.querySelector(
                                "tp-yt-paper-button#expand, " +
                                "#description tp-yt-paper-button#expand, " +
                                "ytd-text-inline-expander tp-yt-paper-button#expand"
                            )

                            if (showMoreBtn) {
                                showMoreBtn.click()
                                await sleep(800)
                            }

                            // find Show transcript button in expanded description
                            const allButtons = document.querySelectorAll(
                                "button, tp-yt-paper-button, ytd-button-renderer"
                            )

                            let transcriptBtn = null
                            for (const btn of allButtons) {
                                if (btn.innerText?.toLowerCase().includes("transcript")) {
                                    transcriptBtn = btn
                                    if (btn.tagName === "BUTTON") break
                                }
                            }

                            if (!transcriptBtn) {
                                return {
                                    error: "Show transcript button not found — " +
                                        "video may not have captions"
                                }
                            }

                            transcriptBtn.click()

                            // poll until segments appear — max 5 seconds
                            let attempts = 0
                            while (getSegments().length === 0 && attempts < 10) {
                                await sleep(500)
                                attempts++
                            }
                        }

                        // ── STEP 3 — read segments from DOM ──────────────────
                        const segments = getSegments()

                        if (segments.length === 0) {
                            return { error: "Transcript panel opened but no segments found" }
                        }

                        const text = Array.from(segments)
                            .map(el => el.innerText?.trim())
                            .filter(Boolean)
                            .join(" ")
                            .replace(/\s+/g, " ")
                            .trim()

                        if (!text || text.length < 50) {
                            return { error: "Transcript text too short" }
                        }

                        return {
                            transcript: text,
                            segmentCount: segments.length,
                            method: "dom_scrape"
                        }
                    }
                })

                const data = result?.[0]?.result
                console.log("[MindVault] DOM scrape result:", data)

                if (data?.transcript) {
                    transcriptResult = {
                        transcript: data.transcript,
                        method: isShorts ? "shorts_url_convert" : "dom_scrape",
                        warning: ""
                    }
                }

            } catch (e) {
                console.log("[MindVault] DOM scrape failed:", e.message)
            }

            // ── DESCRIPTION FALLBACK ──────────────────────────────
            if (!transcriptResult) {
                try {
                    const descResult = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        world: "ISOLATED",
                        func: () => {
                            const title = document.title
                                ?.replace(" - YouTube", "")
                                ?.trim() || ""
                            const descEl = document.querySelector(
                                "#description-inline-expander yt-attributed-string, " +
                                "#description-inline-expander, " +
                                "#description"
                            )
                            const description = descEl?.innerText?.trim() || ""
                            return {
                                transcript: `Video: ${title}\n\nDescription:\n${description}`.trim(),
                                warning: "Full transcript unavailable — summarizing from description only"
                            }
                        }
                    })

                    const descData = descResult?.[0]?.result
                    if (descData?.transcript) {
                        transcriptResult = {
                            ...descData,
                            method: "description_fallback"
                        }
                    }
                } catch (e) {
                    console.log("[MindVault] Description fallback failed:", e.message)
                }
            }

            // ── NAVIGATE BACK to Shorts if we converted ───────────
            if (originalUrl) {
                try {
                    await chrome.tabs.update(tab.id, { url: originalUrl })
                } catch (e) {
                    console.log("[MindVault] Navigate-back failed:", e.message)
                }
            }

            // ── GIVE UP ───────────────────────────────────────────
            if (!transcriptResult?.transcript) {
                return {
                    ok: false,
                    error: "Could not extract transcript. " +
                        "Please make sure the video has captions enabled."
                }
            }

            // ── SEND TO BACKEND ───────────────────────────────────
            return await apiCall("/api/notes/youtube-summarize", {
                method: "POST",
                body: JSON.stringify({
                    transcript: transcriptResult.transcript,
                    video_url: message.videoUrl,
                    video_title: message.videoTitle,
                    annotation: message.annotation || "",
                    extraction_method: transcriptResult.method,
                    warning: transcriptResult.warning || ""
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
