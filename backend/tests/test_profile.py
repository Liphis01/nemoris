import io
import json
import unittest
from unittest import mock
from urllib.error import HTTPError

from fastapi import HTTPException

from app.routers.profile import read_profile, update_profile
from app.schemas import ProfileUpdateRequest
from app.services.profile import get_profile_status, save_profile


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.headers = {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def http_error(request, status, payload):
    body = b"" if payload is None else json.dumps(payload).encode("utf-8")
    return HTTPError(request.full_url, status, "error", {}, io.BytesIO(body))


class ProfileTestCase(unittest.TestCase):
    def signed_in_state(self):
        return {
            "server_url": "https://project.supabase.co",
            "server_key": "sb_publishable_test",
            "account_email": "louis@example.com",
            "token": {
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "user_id": "11111111-1111-1111-1111-111111111111"
            }
        }

    def signed_out_state(self):
        return {
            "server_url": "https://project.supabase.co",
            "server_key": "sb_publishable_test",
            "account_email": None,
            "token": None
        }


class GetProfileStatusTests(ProfileTestCase):
    def test_signed_out_returns_envelope_without_network_call(self):
        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.profile.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            result = get_profile_status()

        self.assertEqual(
            result,
            {"signed_in": False, "account_email": None, "profile": None}
        )

    def test_signed_in_returns_existing_row(self):
        def fake_urlopen(request, timeout):
            self.assertEqual(request.get_method(), "GET")
            self.assertIn(
                "/rest/v1/profiles?user_id=eq."
                "11111111-1111-1111-1111-111111111111",
                request.full_url
            )
            self.assertEqual(
                request.headers.get("Authorization"), "Bearer access-token"
            )
            return FakeResponse([{
                "username": "Louis",
                "avatar_emoji": "🦉",
                "avatar_color": "teal",
                "updated_at": "2026-07-26T10:00:00Z"
            }])

        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch("app.services.profile.urlopen", fake_urlopen):
            result = get_profile_status()

        self.assertTrue(result["signed_in"])
        self.assertEqual(result["account_email"], "louis@example.com")
        self.assertEqual(result["profile"]["username"], "Louis")
        self.assertEqual(result["profile"]["avatar_emoji"], "🦉")
        self.assertEqual(result["profile"]["avatar_color"], "teal")

    def test_signed_in_no_row_yet_returns_null_profile(self):
        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch(
            "app.services.profile.urlopen",
            lambda request, timeout: FakeResponse([])
        ):
            result = get_profile_status()

        self.assertTrue(result["signed_in"])
        self.assertIsNone(result["profile"])

    def test_supabase_error_raises_http_400_via_router(self):
        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch(
            "app.services.profile.urlopen",
            lambda request, timeout: (_ for _ in ()).throw(
                http_error(request, 500, {"message": "down"})
            )
        ):
            with self.assertRaises(HTTPException) as context:
                read_profile()

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "down")


class SaveProfileTests(ProfileTestCase):
    def test_requires_sign_in(self):
        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.profile.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                update_profile(ProfileUpdateRequest(
                    username="Louis", avatar_emoji="🦉", avatar_color="teal"
                ))

        self.assertEqual(context.exception.status_code, 401)

    def test_rejects_too_short_username_before_network_call(self):
        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch(
            "app.services.profile.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(ValueError):
                save_profile("Lo", "🦉", "teal")

    def test_accepts_accented_username(self):
        # Unicode-aware validation on purpose (docs/roadmap.md: allow accents
        # and special characters), not an ASCII-only regex.
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)
            return FakeResponse({
                "username": "Émilié_92",
                "avatar_emoji": "🦉",
                "avatar_color": "teal",
                "updated_at": "2026-07-26T10:00:00Z"
            })

        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch("app.services.profile.urlopen", fake_urlopen):
            result = save_profile("Émilié_92", "🦉", "teal")

        self.assertEqual(result["profile"]["username"], "Émilié_92")
        self.assertEqual(len(calls), 1)

    def test_rejects_invalid_avatar_color(self):
        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch(
            "app.services.profile.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(ValueError):
                save_profile("Louis", "🦉", "chartreuse")

    def test_calls_upsert_rpc_with_expected_payload(self):
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)
            return FakeResponse({
                "username": "Louis",
                "avatar_emoji": "🦉",
                "avatar_color": "teal",
                "updated_at": "2026-07-26T10:00:00Z"
            })

        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch("app.services.profile.urlopen", fake_urlopen):
            result = save_profile("Louis", "🦉", "teal")

        self.assertEqual(
            calls[0].full_url,
            "https://project.supabase.co/rest/v1/rpc/upsert_my_profile"
        )
        self.assertEqual(
            json.loads(calls[0].data.decode("utf-8")),
            {
                "p_username": "Louis",
                "p_avatar_emoji": "🦉",
                "p_avatar_color": "teal"
            }
        )
        self.assertEqual(result["profile"]["username"], "Louis")

    def test_conflict_maps_to_409_via_router(self):
        def fake_urlopen(request, timeout):
            raise http_error(
                request, 409, {"code": "23505", "message": "duplicate key"}
            )

        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch("app.services.profile.urlopen", fake_urlopen):
            with self.assertRaises(HTTPException) as context:
                update_profile(ProfileUpdateRequest(
                    username="Louis", avatar_emoji="🦉", avatar_color="teal"
                ))

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail, "Ce pseudo est déjà pris.")

    def test_refreshes_expired_token_and_retries_once(self):
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)

            if "/auth/v1/token" in request.full_url:
                return FakeResponse({
                    "access_token": "new-access-token",
                    "refresh_token": "new-refresh-token"
                })

            if request.headers.get("Authorization") == "Bearer access-token":
                raise http_error(request, 401, {"message": "expired"})

            self.assertEqual(
                request.headers.get("Authorization"),
                "Bearer new-access-token"
            )
            return FakeResponse({
                "username": "Louis",
                "avatar_emoji": "🦉",
                "avatar_color": "teal",
                "updated_at": "2026-07-26T10:00:00Z"
            })

        saved_states = []

        with mock.patch(
            "app.services.profile.load_sync_state",
            return_value=self.signed_in_state()
        ), mock.patch(
            "app.services.profile.save_sync_state",
            side_effect=lambda state: saved_states.append(state)
        ), mock.patch("app.services.profile.urlopen", fake_urlopen):
            result = save_profile("Louis", "🦉", "teal")

        self.assertEqual(result["profile"]["username"], "Louis")
        # RPC call, refresh call, retried RPC call.
        self.assertEqual(len(calls), 3)
        self.assertEqual(
            saved_states[-1]["token"]["access_token"], "new-access-token"
        )


if __name__ == "__main__":
    unittest.main()
