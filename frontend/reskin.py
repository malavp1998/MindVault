import re

def repl_colors(text):
    # ChatPage & TopicsPage dark theme replacements
    replacements = {
        '"#0a0a0f"': '"var(--bg-primary)"',
        '"#111118"': '"var(--bg-secondary)"',
        '"#16161e"': '"var(--bg-card-hover)"',
        '"#1e1e2e"': '"var(--border)"',
        '"#fff"': '"var(--text-primary)"',
        '"#ddd"': '"var(--text-primary)"',
        '"#aaa"': '"var(--text-secondary)"',
        '"#999"': '"var(--text-secondary)"',
        '"#888"': '"var(--text-secondary)"',
        '"#666"': '"var(--text-muted)"',
        '"#555"': '"var(--text-muted)"',
        '"#444"': '"var(--border-hover)"',
        '"#0d0d14"': '"var(--bg-card)"',
        # TopicsPage specific
        '"#030712"': '"var(--bg-primary)"',
        '"rgba(17,24,39,0.95)"': '"rgba(255,255,255,0.95)"',
        '"#374151"': '"var(--border)"',
        '"rgba(17,24,39,0.9)"': '"rgba(255,255,255,0.9)"',
        '"#1F2937"': '"var(--border)"',
        '"#9CA3AF"': '"var(--text-secondary)"',
        '"#6B7280"': '"var(--text-muted)"',
        '"rgba(17,24,39,0.92)"': '"rgba(255,255,255,0.92)"',
        '"#4B5563"': '"var(--text-muted)"',
        '"#0F1117"': '"var(--bg-secondary)"',
        '"#F9FAFB"': '"var(--text-primary)"',
        '"#1A1D27"': '"var(--bg-card)"',
        '"#232636"': '"var(--bg-card-hover)"',
        '"#E5E7EB"': '"var(--text-primary)"',
        '"#D1D5DB"': '"var(--text-secondary)"',
        # NotePage
        "'rgba(255,255,255,0.06)'": "'var(--bg-card-hover)'",
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text

for file in [
    "src/pages/ChatPage.jsx",
    "src/pages/TopicsPage.jsx",
    "src/pages/NotePage.jsx",
    "src/components/GraphView.jsx",
]:
    with open(file, "r") as f:
        content = f.read()
    with open(file, "w") as f:
        f.write(repl_colors(content))
