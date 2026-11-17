import pytest
from unittest.mock import patch
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
)


class TestPasswordHashing:
    def test_hash_returns_string(self):
        result = hash_password("mysecretpassword")
        assert isinstance(result, str)

    def test_hash_is_not_plaintext(self):
        plain = "mysecretpassword"
        result = hash_password(plain)
        assert result != plain

    def test_hash_starts_with_bcrypt_prefix(self):
        result = hash_password("anypass")
        assert result.startswith("$2b$") or result.startswith("$2a$")

    def test_same_password_produces_different_hashes(self):
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2

    def test_verify_correct_password_returns_true(self):
        plain = "correct_password_123"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_verify_wrong_password_returns_false(self):
        hashed = hash_password("correct_password_123")
        assert verify_password("wrong_password", hashed) is False

    def test_verify_empty_string_against_hash(self):
        hashed = hash_password("non_empty")
        assert verify_password("", hashed) is False

    def test_verify_empty_hash_case(self):
        hashed = hash_password("")
        assert verify_password("", hashed) is True


class TestJWT:
    def test_create_token_returns_string(self):
        token = create_access_token("user123")
        assert isinstance(token, str)
        assert len(token) > 0

    def test_decode_valid_token_returns_subject(self):
        token = create_access_token("user_abc")
        subject = decode_access_token(token)
        assert subject == "user_abc"

    def test_decode_tampered_token_returns_none(self):
        token = create_access_token("user_abc")
        tampered = token[:-5] + "XXXXX"
        assert decode_access_token(tampered) is None

    def test_decode_garbage_returns_none(self):
        assert decode_access_token("not.a.valid.token") is None

    def test_decode_empty_string_returns_none(self):
        assert decode_access_token("") is None

    def test_different_subjects_produce_different_tokens(self):
        t1 = create_access_token("user1")
        t2 = create_access_token("user2")
        assert t1 != t2

    def test_round_trip_preserves_unicode_subject(self):
        subject = "user_åæø_123"
        token = create_access_token(subject)
        assert decode_access_token(token) == subject


class TestValidateSecuritySettings:
    def test_warns_on_insecure_secret_key_in_dev(self, caplog):
        import logging
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            with patch("core.get_settings") as mock_settings:
                s = mock_settings.return_value
                s.secret_key = "change-me"
                s.admin_password = "secure_enough_password"
                from core import validate_security_settings
                with caplog.at_level(logging.WARNING, logger="core"):
                    validate_security_settings()
                assert any("SECRET_KEY" in r.message for r in caplog.records)

    def test_raises_on_insecure_secret_key_in_production(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            with patch("core.get_settings") as mock_settings:
                s = mock_settings.return_value
                s.secret_key = "change-me"
                s.admin_password = "secure_production_password"
                from core import validate_security_settings
                with pytest.raises(RuntimeError, match="SECRET_KEY"):
                    validate_security_settings()

    def test_raises_on_insecure_admin_password_in_production(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            with patch("core.get_settings") as mock_settings:
                s = mock_settings.return_value
                s.secret_key = "a_very_secure_secret_key_xyz_123"
                s.admin_password = "123456789"
                from core import validate_security_settings
                with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
                    validate_security_settings()

    def test_no_error_with_secure_values_in_production(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            with patch("core.get_settings") as mock_settings:
                s = mock_settings.return_value
                s.secret_key = "super_secure_random_key_xyz_abc_123"
                s.admin_password = "V3ryStr0ngP@ssw0rd!"
                from core import validate_security_settings
                validate_security_settings()
