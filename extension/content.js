// content.js — MindVault content script
// Handles page content extraction and YouTube transcript extraction
// Runs in ISOLATED world — uses DOM parsing (not page JS variables)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "GET_PAGE_CONTENT") {
    let content = ""
    try {
      if (typeof Readability !== "undefined") {
        const doc = document.cloneNode(true)
        const reader = new Readability(doc)
        const article = reader.parse()
        content = article?.textContent || document.body.innerText
      } else {
        content = document.body.innerText
      }
    } catch (e) {
      content = document.body.innerText || ""
    }
    sendResponse({ content: content.slice(0, 5000) })
  }

  if (message.type === "GET_YOUTUBE_TRANSCRIPT") {
    extractYoutubeTranscript()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ transcript: null, error: err.message }))
    return true // keep channel open for async
  }

  return true
})

// ── YouTube Transcript Extraction ─────────────────────────────

async function extractYoutubeTranscript() {
  const videoId = getYouTubeVideoIdFromLocation()
  if (!videoId) {
    return { transcript: null, error: "No video ID found in URL" }
  }

  // Method 1 — get caption URL from ytInitialPlayerResponse
  try {
    let playerResponse = null

    // Prefer the live player response (works well on SPA navigations)
    try {
      playerResponse =
        document.querySelector("#movie_player")?.getPlayerResponse?.() ||
        null
    } catch { }

    // If that fails, parse inline scripts for ytInitialPlayerResponse assignment
    if (!playerResponse) {
      playerResponse = extractInitialPlayerResponseFromScripts()
    }

    if (playerResponse) {
      const tracks = playerResponse
        ?.captions
        ?.playerCaptionsTracklistRenderer
        ?.captionTracks

      if (tracks && tracks.length > 0) {
        const track = chooseCaptionTrack(tracks)
        const transcript = await fetchTranscriptFromCaptionTrack(track)
        if (transcript && transcript.length > 100) {
          return { transcript, method: "caption_tracks" }
        }
      }
    }
  } catch (e) {
    console.log("[MindVault] Method 1 failed:", e.message)
  }

  // Method 2 — timedtext API directly with known params
  try {
    const urls = [
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=json3`,
    ]

    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) continue
        const data = await res.json().catch(() => null)
        const text = extractTranscriptTextFromJson3(data)

        if (text && text.length > 100) {
          return { transcript: text, method: "timedtext_direct" }
        }
      } catch { }
    }
  } catch (e) {
    console.log("[MindVault] Method 2 failed:", e.message)
  }

  // Method 3 — description fallback
  const title = document.title?.replace(" - YouTube", "").trim() || ""
  const descEl = document.querySelector(
    "#description-inline-expander yt-attributed-string, " +
    "#description-inline-expander, " +
    "ytd-reel-video-renderer yt-attributed-string#description, " +
    "ytd-reel-video-renderer #description, " +
    "#shorts-inner-container yt-attributed-string, " +
    "#description"
  )
  const description = descEl?.innerText?.trim() || ""

  if (title || description) {
    return {
      transcript: `Video Title: ${title}\n\nDescription:\n${description}`.trim(),
      method: "description_fallback",
      warning: "Full transcript unavailable — summarizing from title and description only"
    }
  }

  return {
    transcript: null,
    error: "No transcript or description found for this video"
  }
}

function getYouTubeVideoIdFromLocation() {
  try {
    const url = new URL(window.location.href)
    const v = url.searchParams.get("v")
    if (v) return v

    // shorts: /shorts/<id>
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] === "shorts" && parts[1]) return parts[1]

    // youtu.be/<id> (in case content script ever runs there)
    if (url.hostname === "youtu.be" && parts[0]) return parts[0]
  } catch { }
  return null
}

function chooseCaptionTrack(tracks) {
  // Prefer English manual captions → English auto → any manual → anything.
  return (
    tracks.find(t => (t.languageCode === "en" || t.languageCode?.startsWith("en")) && !t.kind) ||
    tracks.find(t => (t.languageCode === "en" || t.languageCode?.startsWith("en"))) ||
    tracks.find(t => !t.kind) ||
    tracks[0]
  )
}

function extractTranscriptTextFromJson3(data) {
  const text = data?.events
    ?.filter(e => e?.segs?.length)
    ?.map(e => e.segs.map(s => s?.utf8 || "").join(""))
    ?.join(" ")
    ?.replace(/\s+/g, " ")
    ?.trim()
  return text || null
}

function decodeCaptionBaseUrl(track) {
  if (track?.baseUrl) return track.baseUrl
  const cipher = track?.signatureCipher || track?.cipher
  if (!cipher) return null
  try {
    const params = new URLSearchParams(cipher)
    // Some ciphers use `url=...`, some also include `s` for signature (not handled here).
    const url = params.get("url")
    return url ? decodeURIComponent(url) : null
  } catch {
    return null
  }
}

async function fetchTranscriptFromCaptionTrack(track) {
  const baseUrl = decodeCaptionBaseUrl(track)
  if (!baseUrl) return null

  // Force JSON3 (do not append; override existing fmt if present).
  try {
    const u = new URL(baseUrl, window.location.origin)
    u.searchParams.set("fmt", "json3")
    const res = await fetch(u.toString(), { credentials: "include" })
    const ct = (res.headers.get("content-type") || "").toLowerCase()
    if (res.ok && (ct.includes("json") || ct.includes("javascript") || ct.includes("text/plain"))) {
      const data = await res.json().catch(() => null)
      const text = extractTranscriptTextFromJson3(data)
      if (text) return text
    }
  } catch { }

  // XML fallback
  try {
    const resXml = await fetch(baseUrl, { credentials: "include" })
    if (!resXml.ok) return null
    const xml = await resXml.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, "text/xml")
    const text = Array.from(doc.querySelectorAll("text"))
      .map(el => (el.textContent || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    return text || null
  } catch {
    return null
  }
}

function extractInitialPlayerResponseFromScripts() {
  const scripts = Array.from(document.querySelectorAll("script"))
  for (const script of scripts) {
    const text = script.textContent || ""
    if (!text.includes("ytInitialPlayerResponse")) continue

    const json = extractJsonObjectAfterAssignment(text, "ytInitialPlayerResponse")
    if (!json) continue

    try {
      return JSON.parse(json)
    } catch { }
  }
  return null
}

function extractJsonObjectAfterAssignment(source, varName) {
  // Handles: `var ytInitialPlayerResponse = {...};` across many lines.
  const idx = source.indexOf(varName)
  if (idx === -1) return null
  const eq = source.indexOf("=", idx)
  if (eq === -1) return null
  const start = source.indexOf("{", eq)
  if (start === -1) return null

  let depth = 0
  let inStr = null // "'" | '"'
  let esc = false

  for (let i = start; i < source.length; i++) {
    const ch = source[i]

    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === "\\") {
        esc = true
        continue
      }
      if (ch === inStr) {
        inStr = null
      }
      continue
    }

    if (ch === "\"" || ch === "'") {
      inStr = ch
      continue
    }

    if (ch === "{") depth++
    if (ch === "}") {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }

  return null
}
