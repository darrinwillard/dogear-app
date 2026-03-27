"""
POST /api/audible/connect
Body: { email, password, locale }

Authenticates with Audible via the audible library, stores the refresh token
in Supabase user_profiles, then triggers a library sync.
"""

import json
import os
from http.server import BaseHTTPRequestHandler

import audible
from supabase import create_client


SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def auth_callback(url: str, **kwargs):
    """No-op CAPTCHA callback — will fail if Amazon requires CAPTCHA."""
    return url, {}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        email = body.get("email", "").strip()
        password = body.get("password", "")
        locale = body.get("locale", "us")
        user_id = body.get("user_id", "")

        if not email or not password:
            self._respond(400, {"error": "email and password are required"})
            return

        # Authenticate with Audible
        try:
            auth = audible.Authenticator.from_login(
                username=email,
                password=password,
                locale=locale,
                with_username=False,
                captcha_callback=auth_callback,
            )
        except Exception as exc:
            self._respond(401, {"error": f"Audible authentication failed: {exc}"})
            return

        refresh_token = auth.refresh_token

        # Persist refresh token in Supabase (service role bypasses RLS)
        if user_id:
            try:
                sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
                sb.table("user_profiles").upsert(
                    {
                        "id": user_id,
                        "audible_refresh_token": refresh_token,
                        "audible_locale": locale,
                    }
                ).execute()
            except Exception as exc:
                self._respond(500, {"error": f"Failed to save token: {exc}"})
                return

        self._respond(200, {"ok": True, "locale": locale})

    def _respond(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
