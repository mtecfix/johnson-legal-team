#!/usr/bin/env python3
"""Apply a deploy plan: upload with Content-MD5 integrity checks, delete (prune mode), purge Cloudflare cache."""
import argparse
import base64
import json
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request

PURGE_BATCH = 30  # Cloudflare per-request URL limit on the Free plan


def aws(*args) -> str:
    return subprocess.run(["aws", *args], check=True, capture_output=True, text=True).stdout


def upload(plan: dict, site: pathlib.Path, region: str):
    for item in plan["uploads"]:
        path = site / item["key"]
        md5_b64 = base64.b64encode(bytes.fromhex(item["md5"])).decode()
        result = json.loads(aws("s3api", "put-object", "--bucket", plan["bucket"], "--key", item["key"],
                                "--body", str(path), "--content-type", item["content_type"],
                                "--cache-control", item["cache_control"], "--content-md5", md5_b64,
                                "--region", region, "--output", "json"))
        if result.get("ETag", "").strip('"') != item["md5"]:
            sys.exit(f"ETag mismatch after upload: {item['key']}")
        print(f"uploaded {item['key']}")


def delete(plan: dict, region: str):
    keys = plan["deletes"]
    for start in range(0, len(keys), 1000):
        batch = {"Objects": [{"Key": key} for key in keys[start:start + 1000]], "Quiet": True}
        result = json.loads(aws("s3api", "delete-objects", "--bucket", plan["bucket"], "--delete",
                                json.dumps(batch), "--region", region, "--output", "json") or "{}")
        if result.get("Errors"):
            sys.exit(f"delete errors: {result['Errors']}")
    for key in keys:
        print(f"deleted {key} (delete marker; prior version retained)")


def urls_for(keys, site_url: str):
    """Every public URL that can serve each key: apex + www, and extensionless/root forms for HTML."""
    parsed = urllib.parse.urlparse(site_url)
    hosts = [parsed.netloc, "www." + parsed.netloc]
    urls = set()
    for key in keys:
        paths = ["/" + urllib.parse.quote(key)]
        if key == "index.html":
            paths.append("/")
        elif key.endswith(".html"):
            paths.append("/" + urllib.parse.quote(key[:-5]))
        for host in hosts:
            urls.update(f"{parsed.scheme}://{host}{path}" for path in paths)
    return sorted(urls)


def purge(keys, site_url: str, secret_id: str, region: str):
    if not keys:
        return
    secret = json.loads(aws("secretsmanager", "get-secret-value", "--secret-id", secret_id,
                            "--query", "SecretString", "--output", "text", "--region", region))
    urls = urls_for(keys, site_url)
    for start in range(0, len(urls), PURGE_BATCH):
        request = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/zones/{secret['zone_id']}/purge_cache",
            data=json.dumps({"files": urls[start:start + PURGE_BATCH]}).encode(), method="POST",
            headers={"Authorization": f"Bearer {secret['token']}", "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read())
        if not body.get("success"):
            sys.exit(f"Cloudflare purge failed: {body.get('errors')}")
    print(f"purged {len(urls)} URLs from Cloudflare cache")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plan")
    parser.add_argument("site")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--purge-secret", required=True)
    parser.add_argument("--site-url", required=True)
    args = parser.parse_args()
    plan = json.loads(pathlib.Path(args.plan).read_text(encoding="utf-8"))
    upload(plan, pathlib.Path(args.site), args.region)
    if plan["mode"] == "prune":
        delete(plan, args.region)
    purge([u["key"] for u in plan["uploads"]] + plan["deletes"], args.site_url, args.purge_secret, args.region)
    print(f"done: {len(plan['uploads'])} uploaded, {len(plan['deletes'])} deleted")


if __name__ == "__main__":
    main()
