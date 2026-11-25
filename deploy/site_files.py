"""Shared helpers: enumerate a built site and compute S3 metadata for each file."""
import hashlib
import pathlib

MARKER = ".site-build"

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
    ".yml": "text/yaml; charset=utf-8", ".yaml": "text/yaml; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".pdf": "application/pdf",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}


def content_type(path: pathlib.Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


def cache_control(path: pathlib.Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".html":
        return "public, max-age=300"
    if suffix in IMAGE_SUFFIXES:
        return "public, max-age=86400"
    return "public, max-age=3600"


def md5_hex(path: pathlib.Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def site_files(site: pathlib.Path):
    """Yield (key, path) for every publishable file, sorted by key."""
    for path in sorted(site.rglob("*")):
        if path.is_file() and path.name != MARKER:
            yield path.relative_to(site).as_posix(), path
