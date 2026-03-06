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

            // ── STEP 1 — get caption URL from MAIN world ──────
            // executeScript with world:MAIN has access to
            // #movie_player.getPlayerResponse() unlike content scripts
            try {
                const mainWorldResult = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    world: "MAIN",
                    func: () => {
                        // small retry loop for SPA navigation timing
                        // captions may not be ready immediately
                        const getTrack = () => {
                            const player = document.querySelector("#movie_player")
                            if (!player?.getPlayerResponse) return null

                            const tracks = player
                                .getPlayerResponse()
                                ?.captions
                                ?.playerCaptionsTracklistRenderer
                                ?.captionTracks

                            if (!tracks?.length) return null

                            // prefer english manual captions
                            // then english auto-generated
                            // then first available language
                            return (
                                tracks.find(t => t.languageCode === "en" && !t.kind) ||
                                tracks.find(t => t.languageCode === "en") ||
                                tracks.find(t => t.languageCode?.startsWith("en")) ||
                                tracks[0]
                            )
                        }

                        const track = getTrack()
                        if (!track) return null

                        return {
                            captionUrl: track.baseUrl,
                            languageCode: track.languageCode,
                            trackName: track.name?.simpleText || ""
                        }
                    }
                })

                const trackData = mainWorldResult?.[0]?.result
                console.log("[MindVault] Track data:", trackData)

                if (trackData?.captionUrl) {

                    // ── STEP 2 — fetch transcript using caption URL ──
                    // fetch runs in ISOLATED world so cookies auto included
                    const fetchResult = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        world: "ISOLATED",
                        func: async (captionUrl) => {
                            try {
                                // set fmt=json3 — YouTube may or may not honor it
                                const url = new URL(captionUrl)
                                url.searchParams.set("fmt", "json3")

                                const res = await fetch(url.toString(), {
                                    credentials: "include"
                                })
                                if (!res.ok) return { error: `HTTP ${res.status}` }

                                // read as text first — never assume JSON
                                const rawText = await res.text()

                                // attempt 1 — parse as JSON3
                                try {
                                    const data = JSON.parse(rawText)
                                    const text = data.events
                                        ?.filter(e => e.segs)
                                        ?.map(e => e.segs.map(s => s.utf8 || "").join(""))
                                        ?.join(" ")
                                        ?.replace(/\s+/g, " ")
                                        ?.trim()

                                    if (text && text.length > 50) {
                                        return { transcript: text, format: "json3" }
                                    }
                                } catch (jsonErr) {
                                    console.log("[MindVault] JSON parse failed, trying XML...")
                                }

                                // attempt 2 — parse as XML
                                // remove fmt param entirely so YouTube returns default XML
                                try {
                                    const xmlUrl = new URL(captionUrl)
                                    xmlUrl.searchParams.delete("fmt")

                                    const xmlRes = await fetch(xmlUrl.toString(), {
                                        credentials: "include"
                                    })
                                    const xmlText = await xmlRes.text()

                                    const parser = new DOMParser()
                                    const doc = parser.parseFromString(xmlText, "text/xml")
                                    const segments = doc.querySelectorAll("text")

                                    if (segments.length > 0) {
                                        const text = Array.from(segments)
                                            .map(el => el.textContent
                                                .replace(/&amp;/g, "&")
                                                .replace(/&lt;/g, "<")
                                                .replace(/&gt;/g, ">")
                                                .replace(/&#39;/g, "'")
                                                .replace(/&quot;/g, '"')
                                                .trim()
                                            )
                                            .filter(Boolean)
                                            .join(" ")
                                            .replace(/\s+/g, " ")
                                            .trim()

                                        if (text && text.length > 50) {
                                            return { transcript: text, format: "xml" }
                                        }
                                    }
                                } catch (xmlErr) {
                                    return {
                                        error: "Both JSON and XML parsing failed: " + xmlErr.message
                                    }
                                }

                                return { error: "Could not parse transcript in any format" }

                            } catch (e) {
                                return { error: e.message }
                            }
                        },
                        args: [trackData.captionUrl]
                    })

                    const fetchData = fetchResult?.[0]?.result
                    console.log("[MindVault] Fetch data:", fetchData)

                    if (fetchData?.transcript) {
                        transcriptResult = {
                            transcript: fetchData.transcript,
                            method: "movie_player_main_world",
                            warning: ""
                        }
                    }
                }

            } catch (e) {
                console.log("[MindVault] executeScript failed:", e.message)
            }

            // ── STEP 3 — description fallback if extraction failed ──
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
                                "#attributed-snippet-text"
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

            // ── STEP 4 — give up if nothing worked ───────────────
            if (!transcriptResult?.transcript) {
                return {
                    ok: false,
                    error: "Could not extract transcript. " +
                        "Please make sure the video has captions enabled."
                }
            }

            // ── STEP 5 — send to backend for summarization ────────
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
