from __future__ import annotations
"""Language detection service for smart routing."""

import logging
from langdetect import detect, DetectorFactory

# Set seed for deterministic language detection
DetectorFactory.seed = 0

logger = logging.getLogger(__name__)

# Languages supported by Sarvam AI (Indic languages)
INDIC_LANGUAGES = ["hi", "ta", "te", "kn", "bn", "ml", "gu", "mr", "pa", "or"]


def detect_language(text: str) -> str:
    """Detect the language of the given text. Falls back to 'en' on failure."""
    if not text or len(text.strip()) < 10:
        return "en" # Fallback for very short text 

    try:
        lang = detect(text)
        return lang
    except Exception as e:
        logger.debug(f"Language detection failed, falling back to English: {e}")
        return "en"


def is_indic(lang_code: str) -> bool:
    """Check if the given language code is supported by Sarvam AI."""
    return lang_code in INDIC_LANGUAGES
