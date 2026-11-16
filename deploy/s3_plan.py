#!/usr/bin/env python3
"""Compare a built site with the bucket by MD5 and write a deterministic deploy plan.

  --mode upload : upload new/changed files, never delete (bucket-only objects are reported).
  --mode prune  : upload new/changed files and delete bucket objects that are not in the build.

The plan SHA-256 lets the deploy job prove it is applying exactly the plan a reviewer approved.
"""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from site_files import cache_control, content_type, md5_hex, site_files  # noqa: E402

MIN_BUILD_FILES = 20


def list_bucket(bucket: str, region: str) -> dict:
    result = subprocess.run(
        ["aws", "s3api", "list-objects-v2", "--bucket", bucket, "--region", region, "--output", "json"],
        check=True, capture_output=True, text=True)
    data = json.loads(result.stdout) if result.stdout.strip() else {}
    return {obj["Key"]: obj["ETag"].strip('"') for obj in data.get("Contents") or []}


def build_plan(site: pathlib.Path, bucket: str, region: str, mode: str) -> dict:
    local = list(site_files(site))
    if len(local) < MIN_BUILD_FILES:
        sys.exit(f"build has only {len(local)} files; refusing to plan (possible empty build)")
    remote = list_bucket(bucket, region)
    uploads, unchanged = [], 0
    for key, path in local:
        digest = md5_hex(path)
        if remote.get(key) == digest:  # multipart ETags contain '-' and never match, so they re-upload
            unchanged += 1
            continue
        uploads.append({"key": key, "md5": digest, "size": path.stat().st_size,
                        "content_type": content_type(path), "cache_control": cache_control(path),
                        "status": "changed" if key in remote else "new"})
    local_keys = {key for key, _ in local}
    remote_only = sorted(set(remote) - local_keys)
    return {"bucket": bucket, "mode": mode, "uploads": uploads, "unchanged": unchanged,
            "deletes": remote_only if mode == "prune" else [],
            "remote_only_not_deleted": [] if mode == "prune" else remote_only}


def plan_sha(plan: dict) -> str:
    return hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()


def write_summary(plan: dict, sha: str):
    lines = [f"## Deploy plan: `{plan['bucket']}` ({plan['mode']})", "",
             f"- Upload: **{len(plan['uploads'])}** (unchanged: {plan['unchanged']})",
             f"- Delete: **{len(plan['deletes'])}**",
             f"- Plan SHA-256: `{sha}`", ""]
    if plan["uploads"]:
        lines += ["### Uploads", "| Key | Status | Bytes |", "|---|---|---|"]
        lines += [f"| `{u['key']}` | {u['status']} | {u['size']} |" for u in plan["uploads"]]
    if plan["deletes"]:
        lines += ["", "### Deletes (bucket is versioned; recoverable)"] + [f"- `{k}`" for k in plan["deletes"]]
    if plan["remote_only_not_deleted"]:
        lines += ["", f"### In bucket but not in build ({len(plan['remote_only_not_deleted'])}); removed only by an `s3-prune-*` tag deploy"]
        lines += [f"- `{k}`" for k in plan["remote_only_not_deleted"]]
    text = "\n".join(lines) + "\n"
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as handle:
            handle.write(text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("site")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--mode", choices=["upload", "prune"], required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-delete", type=int, default=80, help="safety cap on deletions")
    parser.add_argument("--expect-sha", help="fail unless the new plan matches this approved plan")
    args = parser.parse_args()

    plan = build_plan(pathlib.Path(args.site), args.bucket, args.region, args.mode)
    if len(plan["deletes"]) > args.max_delete:
        sys.exit(f"plan deletes {len(plan['deletes'])} objects, above --max-delete {args.max_delete}")
    sha = plan_sha(plan)
    pathlib.Path(args.out).write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
    write_summary(plan, sha)
    if args.expect_sha and args.expect_sha != sha:
        sys.exit(f"plan changed since approval: approved {args.expect_sha}, now {sha}. Re-run the workflow.")
    changes = len(plan["uploads"]) + len(plan["deletes"])
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
            handle.write(f"changes={changes}\nplan_sha={sha}\n")


if __name__ == "__main__":
    main()
