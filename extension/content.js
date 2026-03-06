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
  const videoId = new URLSearchParams(window.location.search).get("v")
  if (!videoId) {
    return { transcript: null, error: "No video ID found in URL" }
  }

  // Method 1 — get caption URL from ytInitialPlayerResponse
  try {
    let playerResponse = null

    // try window global first (MAIN world injection may have set it)
    if (window.ytInitialPlayerResponse) {
      playerResponse = window.ytInitialPlayerResponse
    } else {
      // search all scripts on page
      const scripts = Array.from(document.querySelectorAll("script"))
      for (const script of scripts) {
        const text = script.textContent || ""
        if (text.includes("captionTracks")) {
          const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/)
          if (match) {
            try { playerResponse = JSON.parse(match[1]) } catch { }
            break
          }
        }
      }
    }

    if (playerResponse) {
      const tracks = playerResponse
        ?.captions
        ?.playerCaptionsTracklistRenderer
        ?.captionTracks

      if (tracks && tracks.length > 0) {
        // prefer english manual captions, then english auto, then any
        const track =
          tracks.find(t => t.languageCode === "en" && !t.kind) ||
          tracks.find(t => t.languageCode === "en") ||
          tracks.find(t => t.languageCode?.startsWith("en")) ||
          tracks[0]

        const captionUrl = track.baseUrl

        // fetch as JSON3 first
        const res = await fetch(captionUrl + "&fmt=json3")
        if (res.ok) {
          const data = await res.json()
          const text = data.events
            ?.filter(e => e.segs)
            ?.map(e => e.segs.map(s => s.utf8 || "").join(""))
            ?.join(" ")
            ?.replace(/\s+/g, " ")
            ?.trim()

          if (text && text.length > 100) {
            return { transcript: text, method: "caption_tracks_json3" }
          }
        }

        // fallback to XML format
        const resXml = await fetch(captionUrl)
        if (resXml.ok) {
          const xml = await resXml.text()
          const parser = new DOMParser()
          const doc = parser.parseFromString(xml, "text/xml")
          const text = Array.from(doc.querySelectorAll("text"))
            .map(el => el.textContent
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
            )
            .join(" ")
            .trim()

          if (text && text.length > 100) {
            return { transcript: text, method: "caption_tracks_xml" }
          }
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
        const res = await fetch(url)
        if (!res.ok) continue
        const data = await res.json()
        const text = data.events
          ?.filter(e => e.segs)
          ?.map(e => e.segs.map(s => s.utf8 || "").join(""))
          ?.join(" ")
          ?.replace(/\s+/g, " ")
          ?.trim()

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
