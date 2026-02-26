from __future__ import annotations
"""Service for automatically tagging notes and managing tag states."""

from services.llm import llm_complete
from services.language import is_indic


async def generate_tags(content: str, lang: str) -> list[str]:
    """Uses LLM to automatically generate 3-5 relevant tags for the note content."""
    
    if is_indic(lang):
        prompt = f"""
        Is note ke liye 3-5 relevant tags generate karo.
        Sirf tags return karo, comma separated, lowercase.
        Example: machine learning, neural networks, deep learning
        
        Note: {content[:1000]}
        """
    else:
        prompt = f"""
        Generate 3-5 relevant tags for this note.
        Return ONLY tags, comma separated, lowercase.
        Example: machine learning, neural networks, deep learning
        
        Note: {content[:1000]}
        """
    
    response = await llm_complete(prompt, lang)
    
    try:
        # parse comma separated tags
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:-1])
            
        tags = [tag.strip().lower() for tag in cleaned.split(",")]
        # Filter artifacts and length
        tags = [tag for tag in tags if 1 < len(tag) < 30 and tag.isalpha() or " " in tag]
        return tags[:5]  # max 5 tags
    except Exception:
        return []


def merge_tags(auto_tags: list[str], user_tags: list[str]) -> dict:
    """Format tags for dual UI display."""
    return {
        "auto": auto_tags,
        "user": user_tags,
        "all": list(set(auto_tags + user_tags))
    }
