#!/usr/bin/env python3
"""Post-deploy smoke test: key pages return 200 through Cloudflare, uploaded files match byte-for-byte at
the S3 origin, and pruned keys are gone from the origin."""
import hashlib
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = "http://johnsonlegalteam.org.s3-website-us-east-1.amazonaws.com"
KEY_PAGES = ["/", "/practice-areas", "/contact", "/expungements", "/personal-injury"]


def fetch(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "jlt-deploy-smoke-test"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b""


def main():
    site_url, plan_path = sys.argv[1], sys.argv[2]
    plan = json.loads(pathlib.Path(plan_path).read_text(encoding="utf-8"))
    stamp = int(time.time())
    failures = []
    for page in KEY_PAGES:
        status, _ = fetch(f"{site_url}{page}?smoke={stamp}")
        print(f"{status} {site_url}{page}")
        if status != 200:
            failures.append(f"{page} returned {status}")
    for item in plan["uploads"][:25]:
        status, body = fetch(f"{ORIGIN}/{urllib.parse.quote(item['key'])}")
        if status != 200 or hashlib.md5(body).hexdigest() != item["md5"]:
            failures.append(f"origin content mismatch for {item['key']} (status {status})")
    for key in plan["deletes"][:25]:
        status, _ = fetch(f"{ORIGIN}/{urllib.parse.quote(key)}")
        if status != 404:
            failures.append(f"deleted key still served: {key} (status {status})")
    print(f"smoke test: {len(failures)} failures")
    for line in failures:
        print(f"FAIL  {line}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
