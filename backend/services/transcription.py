import os
import tempfile
import yt_dlp
from groq import Groq
from services.language import detect_language
import re

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))


async def download_audio(video_url: str) -> str:
    """Download audio from a YouTube video. Uses user-agent to reduce bot detection."""
    audio_path = os.path.join(tempfile.gettempdir(), "mindvault_temp.mp3")

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': audio_path.replace('.mp3', '.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '128',
        }],
        'quiet': True,
        'nocheckcertificate': True,
        # Reduce bot detection
        'http_headers': {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            ),
        },
        'extractor_args': {'youtube': {'player_client': ['web']}},
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([video_url])

    return audio_path


async def transcribe_youtube(video_url: str) -> tuple[str, str]:
    video_id = extract_video_id(video_url)
    if not video_id:
        raise ValueError(f"Could not extract video ID from URL: {video_url}")

    # Step 1 — try captions via youtube_transcript_api
    # Use list_transcripts() to find ANY available transcript
    caption_error = None
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

        # Try manually created transcripts first (most accurate)
        transcript = None
        try:
            transcript = transcript_list.find_manually_created_transcript(
                ["en", "hi", "ta", "te", "kn", "bn", "ml"]
            )
        except Exception:
            pass

        # Fall back to auto-generated transcripts (YouTube's ASR)
        if transcript is None:
            try:
                transcript = transcript_list.find_generated_transcript(
                    ["en", "hi", "ta", "te", "kn", "bn", "ml"]
                )
            except Exception:
                pass

        # Last resort — grab whatever transcript exists
        if transcript is None:
            for t in transcript_list:
                transcript = t
                break

        if transcript is not None:
            fetched = transcript.fetch()
            text = " ".join([t.text for t in fetched])
            if text.strip():
                lang = detect_language(text)
                return text, lang

    except Exception as e:
        caption_error = str(e)

    # Step 2 — download audio + Whisper (fallback)
    audio_path = None
    try:
        audio_path = await download_audio(video_url)

        with open(audio_path, "rb") as audio_file:
            transcription = groq_client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-large-v3-turbo",
                response_format="text"
            )

        text = transcription
        lang = detect_language(text)
        return text, lang

    except Exception as whisper_error:
        # Both methods failed — give a clear error
        raise RuntimeError(
            f"Could not transcribe video. "
            f"Captions: {caption_error or 'not available'}. "
            f"Audio download: {whisper_error}"
        )

    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


def extract_video_id(url: str) -> str:
    pattern = r'(?:v=|\/)([0-9A-Za-z_-]{11}).*'
    match = re.search(pattern, url)
    return match.group(1) if match else None

