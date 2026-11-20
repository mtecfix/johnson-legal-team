"""JLT daily AWS cost report.

Reads the CUR 2.0 Data Export (CSV.GZ, daily, resource-level) from S3, keeps only the rows
whose resource id matches the JLT patterns, and publishes a plain-text report to SNS.

Modes (Lambda event):
  {"mode": "report"}   default. Uses the Data Export in S3. No per-request AWS cost.
  {"mode": "preview"}  one Cost Explorer call (about $0.01). Account-wide, for layout and
                       delivery tests before the first export file exists.

Usage days in the export are UTC days. The report covers the last complete UTC day.
"""
import csv
import datetime as dt
import gzip
import io
import json
import os
from collections import defaultdict
from decimal import Decimal, InvalidOperation

import boto3

EXPORT_BUCKET = os.environ.get("EXPORT_BUCKET", "")
EXPORT_PREFIX = os.environ.get("EXPORT_PREFIX", "cur/jlt-cur2-daily/data")
TOPIC_ARN = os.environ.get("TOPIC_ARN", "")
PATTERN_PARAM = os.environ.get("PATTERN_PARAM", "")
MAX_DETAIL_LINES = 150
BASELINE_DAYS = 7

# Friendly names for the CUR product codes this account is likely to show.
SERVICE_NAMES = {
    "AWSSecretsManager": "AWS Secrets Manager",
    "awskms": "AWS Key Management Service",
    "AmazonS3": "Amazon S3",
    "AWSLambda": "AWS Lambda",
    "AmazonDynamoDB": "Amazon DynamoDB",
    "AmazonApiGateway": "Amazon API Gateway",
    "AmazonCognito": "Amazon Cognito",
    "AmazonECR": "Amazon ECR",
    "AmazonCloudWatch": "Amazon CloudWatch",
    "AmazonSES": "Amazon SES",
    "AmazonSNS": "Amazon SNS",
    "AmazonVPC": "Amazon VPC",
    "AmazonEC2": "Amazon EC2",
    "AWSEvents": "Amazon EventBridge",
    "AmazonRoute53": "Amazon Route 53",
    "AWSDataTransfer": "AWS Data Transfer",
    "AWSCloudTrail": "AWS CloudTrail",
}

ZERO = Decimal(0)


# ----------------------------------------------------------------------------- helpers
def to_decimal(value):
    try:
        return Decimal(value) if value not in (None, "") else ZERO
    except InvalidOperation:
        return ZERO


def money(value, places=4):
    quant = Decimal(1).scaleb(-places)
    return "${:,}".format(value.quantize(quant))


def qty_text(value):
    text = "{:,.4f}".format(value).rstrip("0").rstrip(".")
    return text or "0"


def service_name(code):
    return SERVICE_NAMES.get(code, code or "(unknown service)")


def matches_jlt(resource_id, patterns):
    """True when the resource id belongs to JLT according to the editable pattern list."""
    rid = (resource_id or "").lower()
    if not rid:
        return False
    if any(token.lower() in rid for token in patterns.get("exclude", [])):
        return False
    return any(token.lower() in rid for token in patterns.get("include", []))


def load_patterns(ssm=None):
    ssm = ssm or boto3.client("ssm")
    value = ssm.get_parameter(Name=PATTERN_PARAM)["Parameter"]["Value"]
    patterns = json.loads(value)
    if not patterns.get("include"):
        raise ValueError("Pattern list has no 'include' entries; refusing to report an empty scope.")
    return patterns


# ----------------------------------------------------------------------------- export data
def list_period_keys(s3, period):
    prefix = "{}/BILLING_PERIOD={}/".format(EXPORT_PREFIX, period)
    keys, token = [], None
    while True:
        kwargs = {"Bucket": EXPORT_BUCKET, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = s3.list_objects_v2(**kwargs)
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".csv.gz")]
        if not page.get("IsTruncated"):
            return keys
        token = page["NextContinuationToken"]


def read_rows(s3, key):
    body = s3.get_object(Bucket=EXPORT_BUCKET, Key=key)["Body"].read()
    with gzip.GzipFile(fileobj=io.BytesIO(body)) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", newline=""))


class Totals:
    """Aggregates export rows into the numbers the report needs."""

    def __init__(self, patterns):
        self.patterns = patterns
        self.account_by_day = defaultdict(lambda: ZERO)
        self.jlt_by_day = defaultdict(lambda: ZERO)
        # day -> (product, usage_type) -> [quantity, unit, cost, resource ids]
        self.detail = defaultdict(dict)
        self.resource_cost = defaultdict(lambda: defaultdict(lambda: ZERO))

    def add(self, row):
        day = (row.get("line_item_usage_start_date") or "")[:10]
        if not day:
            return
        cost = to_decimal(row.get("line_item_unblended_cost"))
        self.account_by_day[day] += cost
        rid = row.get("line_item_resource_id", "")
        if not matches_jlt(rid, self.patterns):
            return
        self.jlt_by_day[day] += cost
        key = (row.get("line_item_product_code", ""), row.get("line_item_usage_type", ""))
        entry = self.detail[day].setdefault(key, [ZERO, row.get("pricing_unit", ""), ZERO, set()])
        entry[0] += to_decimal(row.get("line_item_usage_amount"))
        entry[2] += cost
        entry[3].add(rid)
        self.resource_cost[day][rid] += cost


def collect(s3, patterns, periods):
    totals = Totals(patterns)
    files = 0
    for period in periods:
        for key in list_period_keys(s3, period):
            files += 1
            for row in read_rows(s3, key):
                totals.add(row)
    return totals, files


# ----------------------------------------------------------------------------- report text
def short_resource(rid, width=78):
    return rid if len(rid) <= width else rid[: width - 3] + "..."


def build_report(s3, patterns, now_utc):
    target = (now_utc - dt.timedelta(days=1)).date()
    periods = sorted({target.strftime("%Y-%m"), (target.replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m")})
    totals, files = collect(s3, patterns, periods)
    if files == 0 or not totals.account_by_day:
        subject = "JLT AWS cost report: no export data yet"
        message = (
            "The JLT cost report ran, but the Data Export has not delivered any file yet.\n"
            "AWS delivers the first file within about 24 hours of creating the export, then refreshes it daily.\n"
            "Looked in s3://{}/{}/ for periods {}.\n".format(EXPORT_BUCKET, EXPORT_PREFIX, ", ".join(periods))
        )
        return subject, message

    days_available = sorted(totals.account_by_day)
    day = target.isoformat()
    note = ""
    if day not in totals.account_by_day:
        day = days_available[-1]
        note = "NOTE: {} is not in the export yet; showing the latest day available ({}).\n".format(target.isoformat(), day)
    day_date = dt.date.fromisoformat(day)
    prev_day = (day_date - dt.timedelta(days=1)).isoformat()
    month_prefix = day[:7]

    jlt_day = totals.jlt_by_day.get(day, ZERO)
    account_day = totals.account_by_day.get(day, ZERO)
    mtd_days = [d for d in totals.account_by_day if d.startswith(month_prefix) and d <= day]
    mtd = sum((totals.jlt_by_day.get(d, ZERO) for d in mtd_days), ZERO)
    days_in_month = ((day_date.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)).day
    run_rate = (mtd / Decimal(day_date.day) * Decimal(days_in_month)) if day_date.day else ZERO

    baseline_days = [(day_date - dt.timedelta(days=i)).isoformat() for i in range(1, BASELINE_DAYS + 1)]
    baseline_days = [d for d in baseline_days if d in totals.account_by_day]
    baseline_avg = (sum((totals.jlt_by_day.get(d, ZERO) for d in baseline_days), ZERO) / Decimal(len(baseline_days))) if baseline_days else None

    lines = []
    lines.append("JLT AWS COST REPORT")
    lines.append("Usage day: {} (UTC)    Generated: {} UTC".format(day, now_utc.strftime("%Y-%m-%d %H:%M")))
    lines.append("Status: PRELIMINARY. AWS can still add usage to this day for up to ~48 hours.")
    if note:
        lines.append(note.rstrip())
    lines.append("")
    def summary(label, text):
        lines.append("  {:<38}{}".format(label + ":", text))

    lines.append("SUMMARY")
    summary("JLT cost for the day", money(jlt_day))
    if prev_day in totals.account_by_day:
        summary("Day before ({}, firmer)".format(prev_day), money(totals.jlt_by_day.get(prev_day, ZERO)))
    if baseline_avg is not None:
        change = ""
        if baseline_avg > 0:
            change = "  ({:+.0f}% vs average)".format((jlt_day - baseline_avg) / baseline_avg * 100)
        summary("Average of previous {} day(s)".format(len(baseline_days)), money(baseline_avg) + change)
    summary("Month to date ({}, {} day(s))".format(month_prefix, len(mtd_days)), money(mtd, 2))
    summary("Month-end run-rate", money(run_rate, 2))
    other = account_day - jlt_day
    share = (jlt_day / account_day * 100) if account_day > 0 else ZERO
    summary("Whole account that day", "{}  (JLT is {:.1f}%, shared/other {})".format(money(account_day, 2), share, money(other, 2)))
    lines.append("")

    # Alerts: a usage type that costs real money and is well above its own recent average.
    alerts = []
    for key, (qty, unit, cost, _) in totals.detail.get(day, {}).items():
        past = [totals.detail.get(d, {}).get(key, [ZERO, "", ZERO, set()])[2] for d in baseline_days]
        if len(past) >= 3 and cost >= Decimal("0.01"):
            average = sum(past, ZERO) / Decimal(len(past))
            if cost > average * 2 + Decimal("0.01"):
                alerts.append("  ! {} / {}: {} today vs {} average".format(service_name(key[0]), key[1], money(cost), money(average)))
    if baseline_avg is not None and baseline_avg > 0 and jlt_day > baseline_avg * 2 + Decimal("0.05"):
        alerts.insert(0, "  ! Total JLT cost is more than double its recent average.")
    lines.append("ALERTS")
    lines.extend(alerts or ["  None."])
    lines.append("")

    lines.append("DETAIL BY SERVICE AND USAGE TYPE (quantity, unit, cost)")
    by_service = defaultdict(list)
    for (product, usage_type), (qty, unit, cost, resources) in totals.detail.get(day, {}).items():
        by_service[product].append((usage_type, qty, unit, cost, len(resources)))
    shown = 0
    service_rows = sorted(by_service.items(), key=lambda kv: (-sum((r[3] for r in kv[1]), ZERO), service_name(kv[0])))
    for product, rows in service_rows:
        lines.append("  {}  {}".format(service_name(product), money(sum((r[3] for r in rows), ZERO))))
        for usage_type, qty, unit, cost, count in sorted(rows, key=lambda r: (-r[3], r[0])):
            if shown >= MAX_DETAIL_LINES:
                break
            lines.append("      {:<46} {:>14} {:<18} {:>10}  ({} resource{})".format(
                usage_type[:46], qty_text(qty), (unit or "")[:18], money(cost), count, "" if count == 1 else "s"))
            shown += 1
    if not service_rows:
        lines.append("  No JLT usage rows for this day. Check the patterns in SSM ({}).".format(PATTERN_PARAM))
    lines.append("")

    lines.append("TOP JLT RESOURCES BY COST")
    top = sorted(totals.resource_cost.get(day, {}).items(), key=lambda kv: -kv[1])[:10]
    for rid, cost in top:
        lines.append("  {:>10}  {}".format(money(cost), short_resource(rid)))
    if not top:
        lines.append("  None.")
    lines.append("")
    lines.append("Scope: resources whose id contains any of: {}".format(", ".join(patterns.get("include", []))))
    lines.append("Edit the scope in SSM parameter {}. Source: infra/cost-report in the JLT repo.".format(PATTERN_PARAM))

    subject = "JLT AWS cost {}: {} (MTD {})".format(day, money(jlt_day, 2), money(mtd, 2))
    return subject[:100], "\n".join(lines) + "\n"


# ----------------------------------------------------------------------------- preview (Cost Explorer)
PREVIEW_SERVICES = ("Secrets Manager", "Key Management", "Simple Storage", "Lambda", "DynamoDB", "API Gateway",
                    "Cognito", "Container Registry", "CloudWatch", "Simple Email", "Simple Notification",
                    "EventBridge", "Route 53", "Virtual Private Cloud")


def build_preview(now_utc, ce=None):
    ce = ce or boto3.client("ce", region_name="us-east-1")
    day = (now_utc - dt.timedelta(days=1)).date()
    response = ce.get_cost_and_usage(
        TimePeriod={"Start": day.isoformat(), "End": (day + dt.timedelta(days=1)).isoformat()},
        Granularity="DAILY",
        Metrics=["UnblendedCost", "UsageQuantity"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}, {"Type": "DIMENSION", "Key": "USAGE_TYPE"}],
    )  # one request. The next-page token is deliberately not followed, to keep this to one billed call.
    groups = response["ResultsByTime"][0]["Groups"] if response["ResultsByTime"] else []
    total = ZERO
    by_service = defaultdict(list)
    for group in groups:
        service, usage_type = group["Keys"]
        cost = to_decimal(group["Metrics"]["UnblendedCost"]["Amount"])
        qty = to_decimal(group["Metrics"]["UsageQuantity"]["Amount"])
        unit = group["Metrics"]["UsageQuantity"].get("Unit", "")
        total += cost
        if any(token.lower() in service.lower() for token in PREVIEW_SERVICES):
            by_service[service].append((usage_type, qty, unit, cost))
    lines = [
        "JLT AWS COST REPORT - PREVIEW (TEST MESSAGE)",
        "Usage day: {} (UTC)    Generated: {} UTC".format(day.isoformat(), now_utc.strftime("%Y-%m-%d %H:%M")),
        "",
        "This is a layout and delivery test. Numbers are WHOLE ACCOUNT from Cost Explorer, not JLT only.",
        "The real daily report splits out JLT using the Data Export, which delivers its first file within ~24 hours.",
        "",
        "ACCOUNT TOTAL FOR THE DAY: {}".format(money(total, 2)),
        "",
        "DETAIL FOR SERVICES JLT USES (account-wide; quantity, unit, cost)",
    ]
    for service, rows in sorted(by_service.items(), key=lambda kv: -sum((r[3] for r in kv[1]), ZERO)):
        lines.append("  {}  {}".format(service, money(sum((r[3] for r in rows), ZERO))))
        for usage_type, qty, unit, cost in sorted(rows, key=lambda r: -r[3])[:8]:
            lines.append("      {:<46} {:>14} {:<12} {:>10}".format(usage_type[:46], qty_text(qty), unit[:12], money(cost)))
    if not by_service:
        lines.append("  No matching services returned.")
    lines += ["", "Cost of producing this preview: one Cost Explorer request (about $0.01)."]
    return "JLT AWS cost report PREVIEW {} (test)".format(day.isoformat())[:100], "\n".join(lines) + "\n"


# ----------------------------------------------------------------------------- entry point
def publish(subject, message, sns=None):
    sns = sns or boto3.client("sns")
    sns.publish(TopicArn=TOPIC_ARN, Subject=subject.encode("ascii", "replace").decode()[:100], Message=message)


def lambda_handler(event, context):
    mode = (event or {}).get("mode", "report")
    now = dt.datetime.now(dt.timezone.utc)
    try:
        if mode == "preview":
            subject, message = build_preview(now)
        elif mode == "report":
            subject, message = build_report(boto3.client("s3"), load_patterns(), now)
        else:
            raise ValueError("Unknown mode: {!r}".format(mode))
        publish(subject, message)
        return {"mode": mode, "subject": subject, "bytes": len(message)}
    except Exception as exc:  # report the failure to the same inbox, then fail the invocation
        try:
            publish("JLT AWS cost report FAILED", "The daily JLT cost report failed.\n\n{}: {}\n\nSee CloudWatch log group /aws/lambda/jlt-cost-report.".format(type(exc).__name__, exc))
        finally:
            raise
