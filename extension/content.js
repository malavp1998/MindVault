// content.js — minimal, only used for page content extraction
// all UI is now in popup.html / popup.js

// listen for content extraction requests from popup
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
  return true
})
