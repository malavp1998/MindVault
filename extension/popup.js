// ── STATE ─────────────────────────────────────────────
let currentTab = null
let isYoutube = false
let listenersSetup = false

// ── INIT ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await loadCurrentTab()
    await checkAuthAndRoute()
})

async function loadCurrentTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    currentTab = tabs[0]
    isYoutube = currentTab?.url?.includes("youtube.com/watch")
}

async function checkAuthAndRoute() {
    showScreen("loading")
    const result = await sendMessage({ type: "CHECK_AUTH" })
    if (result?.authenticated) {
        showMain(result.user)
    } else {
        showScreen("login")
        setupLoginListeners()
    }
}

// ── SCREENS ───────────────────────────────────────────
function showScreen(name) {
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"))
    document.getElementById(`screen-${name}`).classList.remove("hidden")
}

function showMain(user) {
    showScreen("main")
    document.getElementById("header-username").textContent = `@${user.username}`

    // populate page info
    if (currentTab) {
        document.getElementById("page-title").textContent =
            currentTab.title || "Untitled"
        document.getElementById("page-url").textContent =
            currentTab.url || ""
    }

    // show correct UI based on page type
    if (isYoutube) {
        // YouTube — show transcription banner only
        document.getElementById("youtube-banner").classList.remove("hidden")
        document.getElementById("save-form").classList.add("hidden")
    } else {
        // normal webpage — show regular save form only
        document.getElementById("youtube-banner").classList.add("hidden")
        document.getElementById("save-form").classList.remove("hidden")
    }

    // load related notes immediately on open
    loadRelatedNotes()
    if (!listenersSetup) {
        setupListeners()
        listenersSetup = true
    }
}

// ── EVENT LISTENERS ───────────────────────────────────
function setupLoginListeners() {
    document.getElementById("btn-login").addEventListener("click", handleLogin)
    document.getElementById("login-password")
        .addEventListener("keydown", e => { if (e.key === "Enter") handleLogin() })
}

function setupListeners() {
    // logout
    document.getElementById("btn-logout").addEventListener("click", handleLogout)

    // tabs
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => switchTab(tab.dataset.tab))
    })

    // save page
    document.getElementById("btn-save-page")
        .addEventListener("click", handleSavePage)

    // summarize youtube
    document.getElementById("btn-summarize-yt")
        .addEventListener("click", handleSummarizeYoutube)

    // search
    document.getElementById("btn-search")
        .addEventListener("click", handleSearch)
    document.getElementById("search-input")
        .addEventListener("keydown", e => { if (e.key === "Enter") handleSearch() })

}

// ── AUTH ──────────────────────────────────────────────
async function handleLogin() {
    const username = document.getElementById("login-username").value.trim()
    const password = document.getElementById("login-password").value
    const errorEl = document.getElementById("login-error")
    const btn = document.getElementById("btn-login")

    if (!username || !password) {
        showError(errorEl, "Enter username and password")
        return
    }

    btn.disabled = true
    btn.textContent = "Logging in..."
    errorEl.classList.add("hidden")

    const result = await sendMessage({ type: "LOGIN", username, password })

    if (result?.success) {
        showMain(result.user)
    } else {
        showError(errorEl, result?.error || "Login failed")
        btn.disabled = false
        btn.textContent = "Login"
    }
}

async function handleLogout() {
    await sendMessage({ type: "LOGOUT" })
    document.getElementById("login-username").value = ""
    document.getElementById("login-password").value = ""
    showScreen("login")
}

// ── TABS ──────────────────────────────────────────────
function switchTab(tabName) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"))
    document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"))
    document.querySelector(`[data-tab="${tabName}"]`).classList.add("active")
    document.getElementById(`tab-${tabName}`).classList.remove("hidden")

    if (tabName === "related") loadRelatedNotes()
}

// ── SAVE PAGE ─────────────────────────────────────────
async function handleSavePage() {
    const btn = document.getElementById("btn-save-page")
    const annotation = document.getElementById("annotation").value.trim()
    const tagsRaw = document.getElementById("user-tags").value.trim()
    const userTags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : []

    btn.disabled = true
    btn.textContent = "Saving..."

    // get page content via content script
    let content = ""
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // use Readability if available else fallback to body text
                if (typeof Readability !== "undefined") {
                    const doc = document.cloneNode(true)
                    const reader = new Readability(doc)
                    const article = reader.parse()
                    return article?.textContent || document.body.innerText
                }
                return document.body.innerText
            }
        })
        content = results[0]?.result || ""
    } catch (e) {
        content = currentTab?.title || ""
    }

    const result = await sendMessage({
        type: "SAVE_NOTE",
        content: content.slice(0, 5000),
        title: currentTab?.title || "Untitled",
        sourceUrl: currentTab?.url || "",
        annotation,
        userTags
    })

    btn.disabled = false
    btn.textContent = "💾 Save to Vault"

    if (result?.ok) {
        const note = result.data
        document.getElementById("save-form").classList.add("hidden")
        const resultEl = document.getElementById("save-result")
        resultEl.classList.remove("hidden")

        // show auto generated tags
        const tagsEl = document.getElementById("result-tags")
        const allTags = [
            ...(note.auto_tags || []).map(t => `<span class="tag tag-auto">${escapeHtml(t)}</span>`),
            ...(note.user_tags || []).map(t => `<span class="tag tag-user">${escapeHtml(t)}</span>`)
        ]
        tagsEl.innerHTML = allTags.join("")

        // reset after 3 seconds
        setTimeout(() => {
            document.getElementById("save-form").classList.remove("hidden")
            resultEl.classList.add("hidden")
            document.getElementById("annotation").value = ""
            document.getElementById("user-tags").value = ""
        }, 3000)
    } else if (result?.status === 401) {
        showScreen("login")
    }
}

// ── YOUTUBE ───────────────────────────────────────────
async function handleSummarizeYoutube() {
    const btn = document.getElementById("btn-summarize-yt")
    const annotation = document.getElementById("annotation").value.trim()

    btn.disabled = true
    btn.textContent = "Extracting transcript..."

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

        const result = await sendMessage({
            type: "SUMMARIZE_YOUTUBE",
            videoUrl: currentTab?.url,
            videoTitle: currentTab?.title?.replace(" - YouTube", "") || "",
            annotation,
            tabId: tab.id
        })

        btn.disabled = false
        btn.textContent = "Summarize & Save"

        if (result?.ok) {
            document.getElementById("save-form").classList.add("hidden")
            document.getElementById("youtube-banner").classList.add("hidden")
            const resultEl = document.getElementById("save-result")
            resultEl.classList.remove("hidden")
            const tagsEl = document.getElementById("result-tags")
            const note = result.data
            tagsEl.innerHTML = (note.auto_tags || [])
                .map(t => `<span class="tag tag-auto">${escapeHtml(t)}</span>`).join("")

            // Show warning if fallback was used
            if (note.warning) {
                const warnEl = document.createElement("div")
                warnEl.style.cssText = "color:#fbbf24;font-size:11px;margin-top:8px;line-height:1.4;"
                warnEl.textContent = "⚠️ " + note.warning
                resultEl.appendChild(warnEl)
            }
        } else if (result?.status === 401) {
            showScreen("login")
        } else {
            const errorMsg = result?.data?.detail || result?.error || "Failed to summarize video. Please try again."
            alert(`❌ ${errorMsg}`)
        }
    } catch (err) {
        btn.disabled = false
        btn.textContent = "Summarize & Save"
        alert("❌ Could not reach MindVault server. Check your connection and try again.")
        console.error("[MindVault] YouTube summarize error:", err)
    }
}

// ── RELATED NOTES ─────────────────────────────────────
async function loadRelatedNotes() {
    const loadingEl = document.getElementById("related-loading")
    const listEl = document.getElementById("related-list")
    const emptyEl = document.getElementById("related-empty")

    loadingEl.classList.remove("hidden")
    listEl.innerHTML = ""
    emptyEl.classList.add("hidden")

    const result = await sendMessage({
        type: "GET_RELATED",
        url: currentTab?.url,
        content: ""
    })

    loadingEl.classList.add("hidden")

    const notes = result?.ok ? (result.data?.notes || []) : []
    if (notes.length > 0) {
        notes.forEach(item => {
            listEl.appendChild(createNoteCard(item.note, item.similarity))
        })
    } else {
        emptyEl.classList.remove("hidden")
    }
}

// ── SEARCH ────────────────────────────────────────────
async function handleSearch() {
    const query = document.getElementById("search-input").value.trim()
    if (!query) return

    const loadingEl = document.getElementById("search-loading")
    const answerEl = document.getElementById("search-answer")
    const sourcesEl = document.getElementById("search-sources")
    const btn = document.getElementById("btn-search")

    btn.disabled = true
    loadingEl.classList.remove("hidden")
    answerEl.classList.add("hidden")
    sourcesEl.innerHTML = ""

    const result = await sendMessage({ type: "SEARCH_VAULT", query })

    loadingEl.classList.add("hidden")
    btn.disabled = false

    if (result?.ok) {
        const rag = result.data?.rag
        const results = result.data?.results || []
        if (rag?.answer) {
            answerEl.classList.remove("hidden")
            answerEl.innerHTML = `
                <div class="answer-label">🧠 From your vault</div>
                <div>${escapeHtml(rag.answer)}</div>
            `
        }
        const sources = rag?.sources || results
        if (sources?.length > 0) {
            sources.forEach(item => {
                const note = item.note || item
                const similarity = item.similarity
                sourcesEl.appendChild(createNoteCard(note, similarity))
            })
        }
    }
}

// ── UI HELPERS ────────────────────────────────────────
function createNoteCard(note, similarity) {
    const card = document.createElement("div")
    card.className = "note-card"
    card.innerHTML = `
        <div class="note-card-title">${escapeHtml(note.title || "Untitled")}</div>
        <div class="note-card-summary">${escapeHtml(note.summary || "")}</div>
        <div class="note-card-meta">
            <div class="tags">
                ${(note.auto_tags || []).slice(0, 2)
            .map(t => `<span class="tag tag-auto">${escapeHtml(t)}</span>`).join("")}
            </div>
            ${similarity
            ? `<span class="similarity">${Math.round(similarity * 100)}% match</span>`
            : ""}
        </div>
    `
    // open note in dashboard on click
    card.addEventListener("click", () => {
        chrome.tabs.create({
            url: `https://mind-vault-ecru.vercel.app/note/${note.id}`
        })
    })
    return card
}

function escapeHtml(str) {
    const div = document.createElement("div")
    div.textContent = str
    return div.innerHTML
}

function showError(el, msg) {
    el.textContent = msg
    el.classList.remove("hidden")
}

// ── MESSAGE HELPER ────────────────────────────────────
function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, response => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
            } else {
                resolve(response)
            }
        })
    })
}
