#!/usr/bin/env python3
"""Generate A/B/C/D sandbox variants of the service parent pages and the practice-areas hub.

A = unchanged control (plus tracking + noindex). B/C/D change copy, call-to-action
placement and layout. Source pages are read from the repo root; outputs are written
next to them as <page>-a.html ... <page>-d.html. Re-running regenerates everything.
"""
import re, sys, pathlib, hashlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
PHONE_DISPLAY, PHONE_HREF = "(833) 659-8378", "tel:18336598378"

SERVICE_PAGES = {
    "expungements":             {"topic": "expungement",        "noun": "Expungement"},
    "misdemeanors":             {"topic": "misdemeanor charge", "noun": "Misdemeanor Charge"},
    "personal-injury":          {"topic": "injury case",        "noun": "Injury Case"},
    "probate-estate-planning":  {"topic": "estate planning or probate matter", "noun": "Estate Matter"},
    "traffic-tickets":          {"topic": "traffic ticket",     "noun": "Traffic Ticket"},
}
HUB = "practice-areas"
VARIANTS = ["a", "b", "c", "d"]
# --production: omit the sandbox "Variant X" badge and the variants.html index page.
PRODUCTION = "--production" in sys.argv[1:]

# Content hash appended to asset URLs so CDN/browser caches pick up every edit immediately.
def asset_version(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()[:10]
CSS_HREF = f"ab-variants.css?v={asset_version('ab-variants.css')}"
JS_SRC = f"ab-track.js?v={asset_version('ab-track.js')}"

def call_panel(topic):
    return f'''
                    <div class="ab-callpanel" data-ab-block="call-panel">
                        <div class="ab-callpanel-text">
                            <strong>Have a {topic} question?</strong>
                            <span>Speak with our team directly.</span>
                        </div>
                        <div class="ab-callpanel-actions">
                            <a href="{PHONE_HREF}" class="btn btn-primary btn-lg" data-cta="call-hero"><i class="fas fa-phone me-2"></i>Call {PHONE_DISPLAY}</a>
                            <a href="contact" class="btn btn-outline-primary btn-lg" data-cta="message-hero">Send a Message</a>
                        </div>
                    </div>'''

def steps_block(topic, heading):
    return f'''
                    <div class="ab-steps" data-ab-block="steps">
                        <h2 class="ab-steps-title">{heading}</h2>
                        <div class="row g-3">
                            <div class="col-md-4"><div class="ab-step"><span class="ab-step-num">1</span><h3>Tell us what happened</h3><p>Share the basics of your {topic}. It takes a few minutes.</p></div></div>
                            <div class="col-md-4"><div class="ab-step"><span class="ab-step-num">2</span><h3>We review your options</h3><p>An attorney looks at the facts and explains what Michigan law may allow.</p></div></div>
                            <div class="col-md-4"><div class="ab-step"><span class="ab-step-num">3</span><h3>You decide next steps</h3><p>You get a clear picture of the process before you decide how to proceed.</p></div></div>
                        </div>
                        <div class="text-center mt-3"><a href="contact" class="btn btn-primary btn-lg" data-cta="steps-start">Start the Conversation</a></div>
                    </div>'''

def compact_cta(label):
    return f'''
                    <div class="ab-compact-cta" data-ab-block="compact-cta">
                        <a href="contact" class="btn btn-primary btn-lg" data-cta="compact-top">{label}</a>
                        <a href="{PHONE_HREF}" class="ab-compact-phone" data-cta="compact-phone">or call {PHONE_DISPLAY}</a>
                    </div>'''

STICKY = f'''
    <div class="ab-stickybar" data-ab-block="sticky-bar">
        <a href="{PHONE_HREF}" class="btn btn-light" data-cta="sticky-call"><i class="fas fa-phone me-2"></i>Call</a>
        <a href="contact" class="btn btn-primary" data-cta="sticky-message"><i class="fas fa-envelope me-2"></i>Message</a>
    </div>'''

def head_and_body(html, page, v):
    n = 0
    html, n = re.subn(r'<meta name="robots" content="[^"]*">', '<meta name="robots" content="noindex, nofollow">', html, count=1)
    if n != 1: raise SystemExit(f"{page}: robots meta not found")
    html, n = re.subn(r'</title>', f' [Variant {v.upper()}]</title>', html, count=1)
    if n != 1: raise SystemExit(f"{page}: </title> not found")
    inject = (f'    <meta name="ab-variant" content="{v.upper()}">\n    <meta name="ab-page" content="{page}">\n'
              f'    <link rel="stylesheet" href="{CSS_HREF}">\n</head>')
    html, n = re.subn(r'</head>', inject, html, count=1)
    if n != 1: raise SystemExit(f"{page}: </head> not found")
    html, n = re.subn(r'<body>', f'<body class="ab-v-{v}">', html, count=1)
    if n != 1: raise SystemExit(f"{page}: plain <body> not found")
    label = 'Variant D (mobile only)' if v == 'd' else f'Variant {v.upper()}'
    tail = '' if PRODUCTION else f'    <div class="ab-badge">{label}</div>\n'
    if v == "d": tail += STICKY + "\n"
    tail += f'    <script src="{JS_SRC}"></script>\n</body>'
    html, n = re.subn(r'</body>', tail, html, count=1)
    if n != 1: raise SystemExit(f"{page}: </body> not found")
    return html

def make_service(src, page, meta, v):
    html = src
    topic, noun = meta["topic"], meta["noun"]
    lead_re = re.compile(r'(<h1>.*?</h1>\s*<p class="lead">.*?</p>)', re.S)
    cta_re = re.compile(r'<a href="contact" class="btn btn-primary btn-lg">([^<]*)</a>')
    if not lead_re.search(html): raise SystemExit(f"{page}: h1+lead not found")
    if not cta_re.search(html):  raise SystemExit(f"{page}: bottom CTA not found")
    if v == "b":
        html = lead_re.sub(lambda m: m.group(1) + call_panel(topic), html, count=1)
        html = cta_re.sub(f'<a href="{PHONE_HREF}" class="btn btn-primary btn-lg" data-cta="bottom-call"><i class="fas fa-phone me-2"></i>Call {PHONE_DISPLAY}</a>', html, count=1)
    elif v == "c":
        html = lead_re.sub(lambda m: m.group(1) + steps_block(topic, f"How a conversation about your {topic} works"), html, count=1)
        html = cta_re.sub(f'<a href="contact" class="btn btn-primary btn-lg" data-cta="bottom-discuss">Discuss Your {noun}</a>', html, count=1)
    elif v == "d":
        html = lead_re.sub(lambda m: m.group(1) + compact_cta("Talk to Our Team"), html, count=1)
        html = cta_re.sub('<a href="contact" class="btn btn-primary btn-lg" data-cta="bottom-talk">Talk to Our Team</a>', html, count=1)
    else:  # control
        html = cta_re.sub(lambda m: m.group(0).replace('class="btn btn-primary btn-lg"', 'class="btn btn-primary btn-lg" data-cta="bottom-original"'), html, count=1)
    return head_and_body(html, page, v)

def make_hub(src, page, v):
    html = src
    hdr_re = re.compile(r'(<section class="page-header">.*?</section>)', re.S)
    cta_re = re.compile(r'<a href="contact" class="btn btn-primary btn-lg mb-3">([^<]*)</a>')
    if not hdr_re.search(html): raise SystemExit(f"{page}: page-header not found")
    if not cta_re.search(html): raise SystemExit(f"{page}: hub CTA not found")
    wrap = lambda inner: '\n    <section class="ab-hub-band"><div class="container"><div class="row"><div class="col-12">' + inner + '\n    </div></div></div></section>'
    if v == "b":
        html = hdr_re.sub(lambda m: m.group(1) + wrap(call_panel("legal question")), html, count=1)
        html = cta_re.sub(f'<a href="{PHONE_HREF}" class="btn btn-primary btn-lg mb-3" data-cta="hub-card-call">Call {PHONE_DISPLAY}</a>', html, count=1)
    elif v == "c":
        html = hdr_re.sub(lambda m: m.group(1) + wrap(steps_block("legal matter", "Not sure which practice area fits? Start here")), html, count=1)
        html = cta_re.sub('<a href="contact" class="btn btn-primary btn-lg mb-3" data-cta="hub-card-discuss">Discuss Your Matter</a>', html, count=1)
    elif v == "d":
        html = hdr_re.sub(lambda m: m.group(1) + wrap(compact_cta("Talk to Our Team")), html, count=1)
        html = cta_re.sub('<a href="contact" class="btn btn-primary btn-lg mb-3" data-cta="hub-card-talk">Talk to Our Team</a>', html, count=1)
    else:
        html = cta_re.sub(lambda m: m.group(0).replace('mb-3"', 'mb-3" data-cta="hub-card-original"', 1), html, count=1)
    return head_and_body(html, page, v)

def main():
    pages = dict(SERVICE_PAGES); pages[HUB] = None
    out = []
    for page, meta in pages.items():
        src = (ROOT / f"{page}.html").read_text(encoding="utf-8")
        for v in VARIANTS:
            html = make_hub(src, page, v) if meta is None else make_service(src, page, meta, v)
            (ROOT / f"{page}-{v}.html").write_text(html, encoding="utf-8")
            out.append((page, v))
    rows = "\n".join(
        f'            <tr><td>{p}</td>' + "".join(f'<td><a href="{p}-{v}">{v.upper()}</a></td>' for v in VARIANTS) + '</tr>'
        for p in pages)
    if PRODUCTION:
        print(f"generated {len(out)} variant pages (production: no badge, no index page)")
        return
    (ROOT / "variants.html").write_text(f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow"><title>A/B/C/D Variants (sandbox)</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet"></head>
<body class="container py-5"><h1>A/B/C/D variants (sandbox)</h1>
<p class="text-muted">A = current page (control). B = call-first with mirrored layout (menu left, logo right, sidebar right). C = guided steps in a teal/amber color scheme. D = mobile-only: compact top CTA + sticky call/message bar (view on a phone or a narrow window).</p>
<table class="table table-bordered w-auto"><thead><tr><th>Page</th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody>
{rows}
</tbody></table></body></html>
''', encoding="utf-8")
    print(f"generated {len(out)} variant pages + variants.html")

if __name__ == "__main__":
    main()
