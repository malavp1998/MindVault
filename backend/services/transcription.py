import os
import tempfile
import yt_dlp
from groq import Groq
from services.language import detect_language
import re

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

async def download_audio(video_url: str) -> str:
    # Save to system temp folder — auto cleaned by OS
    audio_path = os.path.join(tempfile.gettempdir(), "mindvault_temp.mp3")
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': audio_path.replace('.mp3', '.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '128',  # lower quality = smaller file
        }],
        'quiet': True,
        'nocheckcertificate': True
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([video_url])
    
    return audio_path

async def transcribe_youtube(video_url: str) -> tuple[str, str]:
    video_id = extract_video_id(video_url)
    
    # Step 1 — try captions first (fastest, no download needed)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript = YouTubeTranscriptApi.get_transcript(
            video_id,
            languages=["en", "hi", "ta", "te", "kn", "bn", "ml"]
        )
        text = " ".join([t["text"] for t in transcript])
        lang = detect_language(text)
        return text, lang
    
    except Exception:
        pass  # no captions, fallback to Whisper
    
    # Step 2 — download audio to temp folder
    audio_path = None
    try:
        audio_path = await download_audio(video_url)
        
        # Step 3 — send to Groq Whisper API (runs on their servers, not yours)
        with open(audio_path, "rb") as audio_file:
            transcription = groq_client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-large-v3-turbo",
                response_format="text"
                # no language param = auto detect
            )
        
        text = transcription
        lang = detect_language(text)
        return text, lang
    
    finally:
        # Always delete temp file even if error occurs
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)

def extract_video_id(url: str) -> str:
    pattern = r'(?:v=|\/)([0-9A-Za-z_-]{11}).*'
    match = re.search(pattern, url)
    return match.group(1) if match else None
