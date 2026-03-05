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

// ── YouTube Transcript Extraction (ISOLATED world) ────────────
// Since content scripts can't access page JS variables,
// we parse <script> tags to find caption track URLs.

async function extractYoutubeTranscript() {
  try {
    // Method 1 — Parse script tags for caption track URLs
    // YouTube embeds captionTracks data in page source
    let captionUrl = null

    const scripts = document.querySelectorAll("script")
    for (const script of scripts) {
      const text = script.textContent
      if (!text || !text.includes("captionTracks")) continue

      // Find timedtext base URL from the caption tracks JSON
      const urlMatch = text.match(
        /"baseUrl":"(https?:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/
      )
      if (urlMatch) {
        captionUrl = urlMatch[1]
          .replace(/\\u0026/g, "&")
          .replace(/\\u003d/g, "=")
        break
      }
    }

    // Method 2 — Fetch transcript from caption URL
    if (captionUrl) {
      const transcript = await fetchTranscriptFromUrl(captionUrl)
      if (transcript) {
        return { transcript, method: "caption_tracks" }
      }
    }

    // Method 3 — Try timedtext API directly with video ID
    const videoId = new URLSearchParams(window.location.search).get("v")
    if (videoId) {
      const transcript = await fetchTimedText(videoId)
      if (transcript) {
        return { transcript, method: "timedtext_api" }
      }
    }

    // Method 4 — Fallback to video description + title
    const title = document.title?.replace(" - YouTube", "") || ""
    const description = document.querySelector(
      "#description-inline-expander, #description"
    )?.innerText || ""

    if (title || description) {
      return {
        transcript: `Video: ${title}\n\nDescription:\n${description}`,
        method: "description_fallback",
        warning: "Full transcript unavailable — summarizing from description only"
      }
    }

    return { transcript: null, error: "Could not extract any content" }

  } catch (e) {
    return { transcript: null, error: e.message }
  }
}

async function fetchTranscriptFromUrl(captionUrl) {
  try {
    // Try XML format first (default)
    const resp = await fetch(captionUrl)
    const text = await resp.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, "text/xml")
    const segments = doc.querySelectorAll("text")

    if (segments.length > 0) {
      return Array.from(segments)
        .map(s => s.textContent
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
        )
        .join(" ")
        .replace(/\n/g, " ")
        .trim()
    }
  } catch { }

  try {
    // Try JSON3 format
    const separator = captionUrl.includes("?") ? "&" : "?"
    const resp = await fetch(captionUrl + separator + "fmt=json3")
    const data = await resp.json()
    return (data.events || [])
      .filter(e => e.segs)
      .map(e => e.segs.map(s => s.utf8).join(""))
      .join(" ")
      .replace(/\n/g, " ")
      .trim()
  } catch { }

  return null
}

async function fetchTimedText(videoId) {
  // Try common languages
  const langs = ["en", "en-US", "hi", ""]
  for (const lang of langs) {
    try {
      const params = new URLSearchParams({ v: videoId, fmt: "json3" })
      if (lang) params.set("lang", lang)
      const url = `https://www.youtube.com/api/timedtext?${params}`
      const resp = await fetch(url)
      if (!resp.ok) continue
      const data = await resp.json()
      const text = (data.events || [])
        .filter(e => e.segs)
        .map(e => e.segs.map(s => s.utf8).join(""))
        .join(" ")
        .replace(/\n/g, " ")
        .trim()
      if (text) return text
    } catch { }
  }
  return null
}
