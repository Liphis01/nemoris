import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import tls


class TlsBundleResolutionTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.root = Path(self._temp.name)

    def bundle(self, name="bundle.pem"):
        path = self.root / name
        path.write_text("test-ca", encoding="utf-8")
        return path

    def test_existing_ssl_cert_file_is_preserved(self):
        existing = self.bundle()

        with patch.dict(os.environ, {"SSL_CERT_FILE": str(existing)}):
            self.assertEqual(tls.configure_https_ca_bundle(), str(existing))
            self.assertEqual(os.environ["SSL_CERT_FILE"], str(existing))

    def test_invalid_ssl_cert_file_is_replaced_by_available_system_bundle(self):
        existing = self.bundle()

        with patch.dict(os.environ, {"SSL_CERT_FILE": str(self.root / "missing.pem")}):
            with patch.object(tls, "_default_verify_files", return_value=()):
                self.assertEqual(
                    tls.configure_https_ca_bundle(candidates=(existing,)),
                    str(existing),
                )

            self.assertEqual(os.environ["SSL_CERT_FILE"], str(existing))

    def test_certifi_is_fallback_when_no_system_bundle_exists(self):
        certifi_bundle = self.bundle("certifi.pem")
        fake_certifi = types.SimpleNamespace(where=lambda: str(certifi_bundle))

        with patch.dict(os.environ, {"SSL_CERT_FILE": str(self.root / "missing.pem")}):
            with patch.dict(sys.modules, {"certifi": fake_certifi}):
                with patch.object(tls, "_default_verify_files", return_value=()):
                    self.assertEqual(
                        tls.configure_https_ca_bundle(candidates=()),
                        str(certifi_bundle),
                    )

            self.assertEqual(os.environ["SSL_CERT_FILE"], str(certifi_bundle))

    def test_invalid_ssl_cert_file_is_removed_when_no_bundle_exists(self):
        missing = str(self.root / "missing.pem")

        with patch.dict(os.environ, {"SSL_CERT_FILE": missing}):
            with patch.dict(sys.modules, {"certifi": None}):
                with patch.object(tls, "_default_verify_files", return_value=()):
                    self.assertIsNone(tls.configure_https_ca_bundle(candidates=()))

            self.assertNotIn("SSL_CERT_FILE", os.environ)


if __name__ == "__main__":
    unittest.main()
