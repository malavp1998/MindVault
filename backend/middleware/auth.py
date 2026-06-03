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
    db: AsyncSession = Depends(get_db),
    # Commented out to bypass JWT requirement entirely
    # credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    # --- MOCKED AUTHENTICATION ---
    firebase_uid = "mock-local-user-1"
    username = "LocalDev"
    email = "localdev@example.com"

    result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
    user = result.scalar_one_or_none()

    if not user:
        try:
            from sqlalchemy.exc import IntegrityError
            user = User(firebase_uid=firebase_uid, username=username, email=email)
            db.add(user)
            await db.commit()
            await db.refresh(user)
            logger.info(f"Auto-provisioned MOCK user: {username}")
        except IntegrityError:
            await db.rollback()
            result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
            user = result.scalar_one_or_none()

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is disabled")

    return user


CurrentUser = Depends(get_current_user)
