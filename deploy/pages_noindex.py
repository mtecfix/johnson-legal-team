#!/usr/bin/env python3
"""Mark every HTML page in a built site as noindex, nofollow.

Used only by the GitHub Pages staging build (.github/workflows/deploy-pages.yml).
The S3 production build never runs this, so johnsonlegalteam.org stays indexable.

Why: the Pages copy at https://mtecfix.github.io/johnson-legal-team/ is a public staging
mirror of the same content as johnsonlegalteam.org. Without this, search engines could
index it as duplicate content. A robots.txt does not help, because crawlers only read it
at the root of mtecfix.github.io, not at a project subpath.

Usage: pages_noindex.py SITE_DIR
"""
import pathlib
import re
import sys

META = '<meta name="robots" content="noindex, nofollow">'
EXISTING_ROBOTS = re.compile(r'<meta[^>]+name=["\']robots["\'][^>]*>', re.I)
HEAD_OPEN = re.compile(r"<head[^>]*>", re.I)


def mark(path: pathlib.Path) -> str:
    """Return 'replaced', 'inserted' or 'skipped' for one file."""
    text = path.read_text(encoding="utf-8", errors="surrogateescape")
    if EXISTING_ROBOTS.search(text):
        new = EXISTING_ROBOTS.sub(META, text, count=1)
        status = "replaced"
    elif HEAD_OPEN.search(text):
        new = HEAD_OPEN.sub(lambda m: m.group(0) + "\n  " + META, text, count=1)
        status = "inserted"
    else:
        return "skipped"  # fragment or non-page HTML with no <head>
    path.write_text(new, encoding="utf-8", errors="surrogateescape")
    return status


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: pages_noindex.py SITE_DIR")
    root = pathlib.Path(sys.argv[1])
    if not root.is_dir():
        sys.exit(f"not a directory: {root}")
    counts = {"replaced": 0, "inserted": 0, "skipped": 0}
    for page in sorted(root.rglob("*.html")):
        counts[mark(page)] += 1
    print(f"noindex: {counts['inserted']} inserted, {counts['replaced']} replaced, {counts['skipped']} skipped (no <head>)")


if __name__ == "__main__":
    main()
