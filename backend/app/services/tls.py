"""TLS trust-store setup for frozen desktop builds."""

from __future__ import annotations

import os
from pathlib import Path
import ssl


SYSTEM_CA_BUNDLE_CANDIDATES = (
    # Debian/Ubuntu/Arch and many derivatives.
    "/etc/ssl/certs/ca-certificates.crt",
    # Fedora/RHEL/CentOS.
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    # openSUSE and Alpine variants.
    "/etc/ssl/ca-bundle.pem",
    "/etc/ssl/cert.pem",
    # Arch exposes this too when p11-kit extraction is installed.
    "/etc/ca-certificates/extracted/tls-ca-bundle.pem",
    # BSD/local fallback used by some packagers.
    "/usr/local/share/certs/ca-root-nss.crt",
)


def _existing_file(path):
    if not path:
        return None

    try:
        candidate = Path(path)
    except TypeError:
        return None

    return str(candidate) if candidate.is_file() else None


def _certifi_bundle():
    try:
        import certifi
    except ImportError:
        return None

    return _existing_file(certifi.where())


def _default_verify_files():
    paths = ssl.get_default_verify_paths()

    # `cafile` reflects SSL_CERT_FILE when it is set; openssl_cafile is the
    # compiled fallback. Try both, deduped, because PyInstaller builds can move
    # across distros whose OpenSSL defaults do not match the build host.
    seen = set()
    for value in (paths.cafile, paths.openssl_cafile):
        if value and value not in seen:
            seen.add(value)
            yield value


def resolve_ca_bundle(candidates=None):
    configured = _existing_file(os.environ.get("SSL_CERT_FILE"))

    if configured:
        return configured

    candidate_paths = (
        SYSTEM_CA_BUNDLE_CANDIDATES if candidates is None else candidates
    )

    for path in list(_default_verify_files()) + list(candidate_paths):
        existing = _existing_file(path)

        if existing:
            return existing

    return _certifi_bundle()


def configure_https_ca_bundle(candidates=None):
    """Point OpenSSL at a real CA bundle when its default path is not portable.

    The Linux AppImage ships an Ubuntu-built PyInstaller sidecar. Its Python
    OpenSSL defaults can point to files such as /usr/lib/ssl/cert.pem, which
    are not guaranteed to exist on Arch/Fedora/etc. Tauri's updater uses a
    different network stack, so updates may work while Python urllib calls to
    Supabase fail certificate verification and surface as "unreachable".
    """

    bundle = resolve_ca_bundle(candidates=candidates)

    if bundle:
        os.environ["SSL_CERT_FILE"] = bundle
    else:
        # A stale/broken SSL_CERT_FILE is worse than no override; removing it
        # lets OpenSSL still try a valid SSL_CERT_DIR or compiled cert dir.
        configured = os.environ.get("SSL_CERT_FILE")
        if configured and not _existing_file(configured):
            os.environ.pop("SSL_CERT_FILE", None)

    return bundle
