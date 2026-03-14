from bs4 import BeautifulSoup
import re

def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')

    # remove noise elements that add no knowledge value
    for tag in soup(
        ["script", "style", "nav", "footer", "header", "aside", "form", "iframe", "noscript"]
    ):
        tag.decompose()

    for i in range(1, 7):
        for tag in soup.find_all(f'h{i}'):
            if tag.get_text(strip=True):
                tag.insert(0, f"{'#' * i} ")

    for tag in soup.find_all('li'):
        if tag.get_text(strip=True):
            tag.insert(0, "• ")

    for tag in soup.find_all('blockquote'):
        if tag.get_text(strip=True):
            tag.insert(0, "> ")

    for tag in soup.find_all('pre'):
        if tag.get_text(strip=True):
            tag.insert(0, "\n```\n")
            tag.append("\n```\n")

    # Extract text and clean up excessive newlines
    text = soup.get_text(separator='\n\n', strip=True)
    result = re.sub(r'\n{3,}', '\n\n', text)

    return result.strip()


JUNK_PATTERNS = [
    r'^\d+ min read$',
    r'^·[A-Za-z]+ \d+, \d{4}$',
    r'^\d+ListenShare$',
    r'^Follow\d*$',
    r'^Press enter or click to view image.*$',
    r'^Sign (in|up) to continue reading.*$',
    r'^Get unlimited access.*$',
    r'^Member-only story.*$',
]

def strip_metadata_lines(text: str) -> str:
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        stripped = line.strip()
        is_junk = any(
            re.match(pattern, stripped, re.IGNORECASE)
            for pattern in JUNK_PATTERNS
        )
        if not is_junk:
            cleaned.append(line)
    return '\n'.join(cleaned).strip()
