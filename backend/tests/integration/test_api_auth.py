import sys
import os
import asyncio
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from bson import ObjectId
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def _make_user(username="testuser", email="test@example.com", password_hash=None, role="user", is_blocked=False):
    from core import hash_password
    return {
        "_id": ObjectId(),
        "username": username,
        "email": email,
        "password_hash": password_hash or hash_password("password123"),
        "display_name": username,
        "created_at": datetime.now(timezone.utc),
        "avatar_url": None,
        "bio": None,
        "role": role,
        "is_blocked": is_blocked,
        "elo": 1200,
        "last_seen": datetime.now(timezone.utc),
    }


def _make_mock_db():
    db = MagicMock()
    db.users = MagicMock()
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock(return_value=MagicMock(inserted_id=ObjectId()))
    db.users.update_one = AsyncMock()
    return db


class TestSignupFunction:
    async def test_signup_new_user_returns_token(self):
        from core import SignupRequest
        from api import signup
        mock_db = _make_mock_db()
        with patch("api.get_db", return_value=mock_db):
            body = SignupRequest(username="newuser", email="new@example.com", password="SecurePass123")
            result = await signup(body)
        assert hasattr(result, "access_token") and len(result.access_token) > 0

    async def test_signup_duplicate_email_raises_409(self):
        from core import SignupRequest
        from api import signup
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=_make_user(email="taken@example.com"))
        with patch("api.get_db", return_value=mock_db):
            body = SignupRequest(username="newuser", email="taken@example.com", password="SecurePass123")
            with pytest.raises(HTTPException) as exc_info:
                await signup(body)
        assert exc_info.value.status_code == 409
        assert "Email" in exc_info.value.detail

    async def test_signup_duplicate_username_raises_409(self):
        from core import SignupRequest
        from api import signup

        async def mock_find(f, *a, **kw):
            return None if "email" in f else _make_user(username="taken")

        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(side_effect=mock_find)
        with patch("api.get_db", return_value=mock_db):
            body = SignupRequest(username="taken", email="new@example.com", password="SecurePass123")
            with pytest.raises(HTTPException) as exc_info:
                await signup(body)
        assert exc_info.value.status_code == 409
        assert "Username" in exc_info.value.detail

    async def test_signup_stores_hashed_password(self):
        from core import SignupRequest
        from api import signup
        captured = {}

        async def capture(doc):
            captured.update(doc)
            return MagicMock(inserted_id=ObjectId())

        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=None)
        mock_db.users.insert_one = AsyncMock(side_effect=capture)
        with patch("api.get_db", return_value=mock_db):
            body = SignupRequest(username="newuser", email="new@example.com", password="mypassword")
            await signup(body)
        assert captured["password_hash"] != "mypassword"
        assert captured["password_hash"].startswith("$2")

    async def test_signup_returned_token_decodes_to_new_user_id(self):
        from core import SignupRequest, decode_access_token
        from api import signup
        new_id = ObjectId()
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=None)
        mock_db.users.insert_one = AsyncMock(return_value=MagicMock(inserted_id=new_id))
        with patch("api.get_db", return_value=mock_db):
            body = SignupRequest(username="newuser", email="new@example.com", password="SecurePass123")
            result = await signup(body)
        assert decode_access_token(result.access_token) == str(new_id)


class TestLoginFunction:
    async def test_login_valid_credentials_returns_token(self):
        from core import LoginRequest, hash_password
        from api import login
        user = _make_user(email="user@example.com", password_hash=hash_password("correct_pass"))
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=user)
        with patch("api.get_db", return_value=mock_db):
            result = await login(LoginRequest(email="user@example.com", password="correct_pass"))
        assert hasattr(result, "access_token") and len(result.access_token) > 0

    async def test_login_wrong_password_raises_401(self):
        from core import LoginRequest, hash_password
        from api import login
        user = _make_user(email="user@example.com", password_hash=hash_password("correct_pass"))
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=user)
        with patch("api.get_db", return_value=mock_db):
            with pytest.raises(HTTPException) as exc_info:
                await login(LoginRequest(email="user@example.com", password="wrong"))
        assert exc_info.value.status_code == 401

    async def test_login_nonexistent_user_raises_401(self):
        from core import LoginRequest
        from api import login
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=None)
        with patch("api.get_db", return_value=mock_db):
            with pytest.raises(HTTPException) as exc_info:
                await login(LoginRequest(email="ghost@example.com", password="any"))
        assert exc_info.value.status_code == 401

    async def test_login_blocked_user_raises_403(self):
        from core import LoginRequest, hash_password
        from api import login
        user = _make_user(email="b@e.com", password_hash=hash_password("pass"), is_blocked=True)
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=user)
        with patch("api.get_db", return_value=mock_db):
            with pytest.raises(HTTPException) as exc_info:
                await login(LoginRequest(email="b@e.com", password="pass"))
        assert exc_info.value.status_code == 403

    async def test_login_token_contains_correct_user_id(self):
        from core import LoginRequest, hash_password, decode_access_token
        from api import login
        user_id = ObjectId()
        user = _make_user(email="u@e.com", password_hash=hash_password("pass"))
        user["_id"] = user_id
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=user)
        with patch("api.get_db", return_value=mock_db):
            result = await login(LoginRequest(email="u@e.com", password="pass"))
        assert decode_access_token(result.access_token) == str(user_id)


class TestGetCurrentUser:
    async def test_valid_token_resolves_user(self):
        from core import create_access_token
        from api import get_current_user
        user_id = ObjectId()
        user = _make_user()
        user["_id"] = user_id
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=user)
        with patch("api.get_db", return_value=mock_db):
            result = await get_current_user(token=create_access_token(str(user_id)))
        assert result["_id"] == user_id

    async def test_invalid_token_raises_401(self):
        from api import get_current_user
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(token="not.valid.token")
        assert exc_info.value.status_code == 401

    async def test_expired_token_raises_401(self):
        from core import create_access_token
        from api import get_current_user
        token = create_access_token("some_id", expires_delta=timedelta(seconds=-1))
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(token=token)
        assert exc_info.value.status_code == 401

    async def test_missing_user_in_db_raises_401(self):
        from core import create_access_token
        from api import get_current_user
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=None)
        with patch("api.get_db", return_value=mock_db):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(token=create_access_token(str(ObjectId())))
        assert exc_info.value.status_code == 401

    async def test_blocked_user_raises_403(self):
        from core import create_access_token
        from api import get_current_user
        user_id = ObjectId()
        user = _make_user(is_blocked=True)
        user["_id"] = user_id
        mock_db = _make_mock_db()
        mock_db.users.find_one = AsyncMock(return_value=user)
        with patch("api.get_db", return_value=mock_db):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(token=create_access_token(str(user_id)))
        assert exc_info.value.status_code == 403


class TestGetMeFunction:
    async def test_get_me_returns_public_profile(self):
        from api import get_me
        user = _make_user(username="myuser", email="me@example.com")
        result = await get_me(current_user=user)
        assert result.username == "myuser"
        assert result.email == "me@example.com"

    async def test_get_me_does_not_expose_password_hash(self):
        from api import get_me
        user = _make_user()
        result = await get_me(current_user=user)
        assert "password_hash" not in result.model_dump()

    async def test_get_me_includes_role(self):
        from api import get_me
        user = _make_user(role="admin")
        result = await get_me(current_user=user)
        assert result.role == "admin"
