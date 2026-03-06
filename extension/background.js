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
            const [tab] = await chrome.tabs.query({
                active: true, currentWindow: true
            })

            let transcriptResult = null

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

                        // ── STEP 2 — if not open, click ... menu to open it ──
                        if (getSegments().length === 0) {

                            // find the ... more actions button under video
                            const menuBtn = document.querySelector(
                                "#above-the-fold #button-shape button, " +
                                "ytd-menu-renderer yt-icon-button button"
                            )

                            if (!menuBtn) {
                                return { error: "Could not find menu button" }
                            }

                            menuBtn.click()
                            await sleep(800)

                            // find Show transcript in dropdown
                            const menuItems = document.querySelectorAll(
                                "ytd-menu-service-item-renderer, " +
                                "tp-yt-paper-item"
                            )

                            let transcriptBtn = null
                            for (const item of menuItems) {
                                if (item.innerText?.toLowerCase().includes("transcript")) {
                                    transcriptBtn = item
                                    break
                                }
                            }

                            if (!transcriptBtn) {
                                // close menu and return error
                                document.dispatchEvent(
                                    new KeyboardEvent("keydown", {
                                        key: "Escape", bubbles: true
                                    })
                                )
                                return {
                                    error: "Show transcript option not found — " +
                                        "video may not have captions"
                                }
                            }

                            transcriptBtn.click()

                            // wait for transcript panel to fully render
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
                        method: data.method,
                        warning: ""
                    }
                }

            } catch (e) {
                console.log("[MindVault] DOM scrape failed:", e.message)
            }

            // ── FALLBACK — description only ───────────────────────
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
                                "#description-inline-expander"
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
