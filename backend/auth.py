import secrets
import time
from typing import Dict, Optional

from .config_store import config_store

TOKEN_TTL_SECONDS = 60 * 60 * 12  # 12 hours


class AuthManager:
    def __init__(self):
        self.tokens: Dict[str, float] = {}

    def login(self, password: str) -> Optional[str]:
        stored = config_store.get_auth_password()
        if secrets.compare_digest(stored, password):
            token = secrets.token_hex(16)
            self.tokens[token] = time.time() + TOKEN_TTL_SECONDS
            return token
        return None

    def verify(self, token: str) -> bool:
        expires = self.tokens.get(token)
        now = time.time()
        if not expires:
            return False
        if expires < now:
            self.tokens.pop(token, None)
            return False
        # refresh sliding expiration
        self.tokens[token] = now + TOKEN_TTL_SECONDS
        return True

    def logout(self, token: str) -> None:
        self.tokens.pop(token, None)


auth_manager = AuthManager()
