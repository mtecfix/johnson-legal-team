#!/usr/bin/env python3
"""Pre-deploy checks on a built site. Any failure exits 1; warnings are reported only."""
import html.parser
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.parse

TEXT_SUFFIXES = {".html", ".js", ".css", ".json", ".md", ".yml", ".yaml", ".txt", ".xml"}
SECRET_RE = re.compile(r"AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}"
                       r"|sk_live_[0-9A-Za-z]{20,}|rk_live_[0-9A-Za-z]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
                       r"|xox[abprs]-[0-9A-Za-z-]{10,}")
PLACEHOLDER_RE = re.compile(r"YOUR_[A-Z_]+|REPLACE_AFTER_DEPLOY|yourdomain\.com|your-unique-link-here")
EXTERNAL_RE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#)", re.I)
VARIANT_RE = re.compile(r"^(?P<base>.+)-(?P<v>[abcd])\.html$")
INLINE_SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>", re.S | re.I)


class RefParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("href", "src") and value:
                self.refs.append(value.strip())


def resolves(site: pathlib.Path, page: pathlib.Path, ref: str) -> bool:
    path = urllib.parse.unquote(ref.split("#")[0].split("?")[0])
    if path in ("", "/"):
        return True
    base = site if path.startswith("/") else page.parent
    target = pathlib.Path(os.path.normpath(base / path.lstrip("/")))
    if site.resolve() not in [target.resolve(), *target.resolve().parents]:
        return False
    return target.is_file() or target.with_name(target.name + ".html").is_file() or (target / "index.html").is_file()


def main():
    site = pathlib.Path(sys.argv[1])
    failures, warnings = [], []
    files = [p for p in site.rglob("*") if p.is_file()]
    html_files = sorted(p for p in files if p.suffix == ".html")

    for page in html_files:
        text = page.read_text(encoding="utf-8", errors="replace")
        rel = page.relative_to(site).as_posix()
        parser = RefParser()
        parser.feed(text)
        for ref in parser.refs:
            if EXTERNAL_RE.match(ref) or "${" in ref or "{{" in ref:
                continue
            if not resolves(site, page, ref):
                failures.append(f"broken link: {rel} -> {ref}")
        for index, match in enumerate(INLINE_SCRIPT_RE.finditer(text)):
            attrs, code = match.group(1), match.group(2)
            if not code.strip() or re.search(r"type=[\"'](?!text/javascript|module)", attrs):
                continue
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tmp:
                tmp.write(code)
            result = subprocess.run(["node", "--check", tmp.name], capture_output=True, text=True)
            os.unlink(tmp.name)
            if result.returncode:
                first = (result.stderr.strip().splitlines() or ["?"])[-1]
                failures.append(f"inline script syntax error: {rel} script #{index}: {first[:120]}")
        variant = VARIANT_RE.match(page.name)
        if variant and (page.parent / f"{variant['base']}.html").is_file():
            if 'content="noindex' not in text:
                failures.append(f"variant missing noindex: {rel}")
            if f'rel="canonical" href="https://johnsonlegalteam.org/{variant["base"]}.html"' not in text:
                failures.append(f"variant canonical not pointing at base page: {rel}")
            if 'class="ab-badge"' in text:
                failures.append(f"sandbox badge present in production variant: {rel}")

    for path in files:
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(site).as_posix()
        for match in SECRET_RE.finditer(text):
            failures.append(f"possible secret in {rel}: {match.group(0)[:8]}...")
        for match in set(PLACEHOLDER_RE.findall(text)):
            warnings.append(f"placeholder in {rel}: {match}")

    for line in sorted(set(warnings)):
        print(f"WARN  {line}")
    for line in failures:
        print(f"FAIL  {line}")
    print(f"checked {len(files)} files ({len(html_files)} HTML): {len(failures)} failures, {len(set(warnings))} warnings")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
