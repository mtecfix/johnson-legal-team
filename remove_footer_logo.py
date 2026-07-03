import os
import re
from pathlib import Path

base = Path(__file__).parent
html_files = list(base.rglob("*.html"))

# Pattern matches the img tag with logo-cropped.png that has margin-right (footer logo)
pattern = re.compile(
    r'\s*<img\s+src="[^"]*logo-cropped\.png"[^>]*margin-right[^>]*>\s*',
    re.IGNORECASE
)

changed = []
for f in html_files:
    content = f.read_text(encoding="utf-8")
    new_content, count = pattern.subn("", content)
    if count:
        f.write_text(new_content, encoding="utf-8")
        changed.append((f.relative_to(base), count))

print(f"Done. Modified {len(changed)} file(s):")
for name, n in changed:
    print(f"  {name}  ({n} removal)")
