from __future__ import annotations
"""Firebase authentication middleware — verifies Firebase ID tokens."""

import uuid, os, logging, pathlib
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

from database import get_db
from models import User

logger = logging.getLogger(__name__)
security = HTTPBearer()

_firebase_initialized = False

def _init_firebase():
    global _firebase_initialized
    if _firebase_initialized or firebase_admin._DEFAULT_APP_NAME in firebase_admin._apps:
        _firebase_initialized = True
        return
    
    # Check local path and Render's default secret path
    local_sa_path = pathlib.Path(__file__).parent.parent / "firebase-service-account.json"
    render_sa_path = pathlib.Path("/etc/secrets/firebase-service-account.json")
    
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        cred = credentials.ApplicationDefault()
    elif local_sa_path.exists():
        cred = credentials.Certificate(str(local_sa_path))
    elif render_sa_path.exists():
        cred = credentials.Certificate(str(render_sa_path))
    else:
        cred = credentials.ApplicationDefault()
        
    firebase_admin.initialize_app(cred, {"projectId": os.getenv("FIREBASE_PROJECT_ID", "mindvault-1")})
    _firebase_initialized = True
    logger.info("✅ Firebase Admin SDK initialized")

_init_firebase()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    id_token = credentials.credentials
    try:
        decoded = firebase_auth.verify_id_token(id_token)
    except firebase_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firebase token expired")
    except firebase_auth.InvalidIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Firebase token")
    except Exception as e:
        logger.warning(f"Firebase token verification failed: {e}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token verification failed")

    firebase_uid: str = decoded["uid"]
    email: str = decoded.get("email", "")
    display_name: str = decoded.get("name", "") or decoded.get("display_name", "")

    result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
    user = result.scalar_one_or_none()

    if not user:
        username = display_name or (email.split("@")[0] if email else firebase_uid[:12])
        base_username = username
        suffix = 1
        while True:
            existing = await db.execute(select(User).where(User.username == username))
            if not existing.scalar_one_or_none():
                break
            username = f"{base_username}{suffix}"
            suffix += 1
        user = User(firebase_uid=firebase_uid, username=username, email=email or None)
        db.add(user)
        await db.flush()
        await db.refresh(user)
        logger.info(f"Auto-provisioned new user: {username} (uid={firebase_uid})")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is disabled")

    return user


CurrentUser = Depends(get_current_user)
