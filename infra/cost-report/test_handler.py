"""Unit tests for handler.py using synthetic Data Export rows. Run: python3 -m unittest -v"""
import csv
import datetime as dt
import gzip
import io
import json
import os
import sys
import types
import unittest

# boto3 is only needed for real AWS clients; the tests inject fakes, so a stub keeps them dependency-free.
sys.modules.setdefault("boto3", types.ModuleType("boto3"))

os.environ.update(EXPORT_BUCKET="test-bucket", EXPORT_PREFIX="cur/jlt-cur2-daily/data",
                  TOPIC_ARN="arn:aws:sns:us-east-1:000000000000:t", PATTERN_PARAM="/jlt/cost-report/patterns")
import handler  # noqa: E402

COLUMNS = ["bill_billing_period_start_date", "line_item_line_item_type", "line_item_usage_start_date",
           "line_item_product_code", "line_item_usage_type", "line_item_operation", "line_item_resource_id",
           "line_item_usage_amount", "line_item_unblended_cost", "line_item_line_item_description",
           "product_region_code", "pricing_unit"]
PATTERNS = json.load(open(os.path.join(os.path.dirname(__file__), "patterns.json")))


def row(day, product, usage_type, rid, qty, cost, unit="Hrs", kind="Usage"):
    return {"bill_billing_period_start_date": day[:7] + "-01T00:00:00Z", "line_item_line_item_type": kind,
            "line_item_usage_start_date": day + "T00:00:00Z", "line_item_product_code": product,
            "line_item_usage_type": usage_type, "line_item_operation": "", "line_item_resource_id": rid,
            "line_item_usage_amount": str(qty), "line_item_unblended_cost": str(cost),
            "line_item_line_item_description": "", "product_region_code": "us-east-1", "pricing_unit": unit}


def gz_csv(rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return gzip.compress(buf.getvalue().encode())


class FakeS3:
    def __init__(self, files):
        self.files = files  # key -> bytes

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        keys = [k for k in self.files if k.startswith(Prefix)]
        return {"Contents": [{"Key": k} for k in keys], "IsTruncated": False}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.files[Key])}


def day(n, base=dt.date(2026, 11, 19)):
    return (base - dt.timedelta(days=n)).isoformat()


class ReportTests(unittest.TestCase):
    def build_rows(self, spike=False):
        rows = []
        for n in range(0, 8):
            d = day(n)
            secret_cost = "0.1067"
            rows.append(row(d, "AWSSecretsManager", "USE1-AWSSecretsManager-Secrets",
                            "arn:aws:secretsmanager:us-east-1:663877906756:secret:johnsonlegalteam/php-api-hmac-AbCd", 8, secret_cost, "Secrets"))
            rows.append(row(d, "awskms", "USE1-KMS-Keys", "arn:aws:kms:us-east-1:663877906756:key/f2cb1248-04fe-4146-8f63-8e673b6ac33e", 1, "0.0333", "Keys"))
            rows.append(row(d, "AWSLambda", "USE1-Lambda-GB-Second", "arn:aws:lambda:us-east-1:663877906756:function:jlt-php-api", 12.5, "0.0000", "Lambda-GB-Second"))
            # not JLT: worker server and a shared secret
            rows.append(row(d, "AmazonEC2", "BoxUsage:t3.large", "i-0a776c518d88d6101", 24, "2.0000"))
            rows.append(row(d, "AWSSecretsManager", "USE1-AWSSecretsManager-Secrets", "arn:aws:secretsmanager:us-east-1:663877906756:secret:metrotec/ssh-key-ZzZz", 40, "0.5333", "Secrets"))
        if spike:
            rows.append(row(day(0), "AmazonS3", "USE1-Requests-Tier1", "johnsonlegalteam.org", 900000, "4.5000", "Requests"))
        rows.append(row(day(0), "AmazonEC2", "Tax", "", 0, "0.2000", kind="Tax"))  # no resource id: never attributed
        return rows

    def make_s3(self, rows):
        return FakeS3({"cur/jlt-cur2-daily/data/BILLING_PERIOD=2026-11/jlt-cur2-daily-00001.csv.gz": gz_csv(rows)})

    now = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.timezone.utc)

    def test_attribution(self):
        self.assertTrue(handler.matches_jlt("arn:aws:secretsmanager:us-east-1:1:secret:johnsonlegalteam/x", PATTERNS))
        self.assertTrue(handler.matches_jlt("arn:aws:apigateway:us-east-1::/apis/2hp2bdxsz6/stages/$default", PATTERNS))
        self.assertTrue(handler.matches_jlt("/aws/lambda/jude-leads", PATTERNS))
        self.assertFalse(handler.matches_jlt("i-0a776c518d88d6101", PATTERNS))
        self.assertFalse(handler.matches_jlt("", PATTERNS))
        self.assertFalse(handler.matches_jlt("jlt-x", {"include": ["jlt-"], "exclude": ["jlt-x"]}))

    def test_report_numbers(self):
        subject, message = handler.build_report(self.make_s3(self.build_rows()), PATTERNS, self.now)
        self.assertIn("2026-11-19", subject)
        self.assertLessEqual(len(subject), 100)
        subject.encode("ascii")
        self.assertRegex(message, r"JLT cost for the day:\s+\$0\.1400")        # 0.1067 + 0.0333 + 0
        self.assertRegex(message, r"Month to date \(2026-11, 8 day\(s\)\):\s+\$1\.12")  # 8 days x 0.14
        self.assertIn("Lambda-GB-Second", message)                              # unit not truncated
        self.assertIn("AWS Secrets Manager", message)
        self.assertIn("USE1-AWSSecretsManager-Secrets", message)
        self.assertNotIn("BoxUsage", message)                           # worker server is not JLT
        self.assertNotIn("metrotec/ssh-key", message)
        self.assertIn("ALERTS\n  None.", message)

    def test_alert_on_spike(self):
        _, message = handler.build_report(self.make_s3(self.build_rows(spike=True)), PATTERNS, self.now)
        self.assertIn("! Total JLT cost is more than double", message)
        self.assertIn("Amazon S3 / USE1-Requests-Tier1", message)

    def test_no_data_yet(self):
        subject, message = handler.build_report(FakeS3({}), PATTERNS, self.now)
        self.assertIn("no export data yet", subject)
        self.assertIn("first file within about 24 hours", message)

    def test_falls_back_to_latest_day(self):
        now = dt.datetime(2026, 11, 22, 12, 0, tzinfo=dt.timezone.utc)  # target 11-21, export ends 11-19
        _, message = handler.build_report(self.make_s3(self.build_rows()), PATTERNS, now)
        self.assertIn("showing the latest day available (2026-11-19)", message)

    def test_empty_patterns_rejected(self):
        class Ssm:
            def get_parameter(self, Name):
                return {"Parameter": {"Value": json.dumps({"include": []})}}
        with self.assertRaises(ValueError):
            handler.load_patterns(Ssm())

    def test_preview_one_call(self):
        calls = []

        class Ce:
            def get_cost_and_usage(self, **kwargs):
                calls.append(kwargs)
                return {"ResultsByTime": [{"Groups": [
                    {"Keys": ["AWS Secrets Manager", "USE1-AWSSecretsManager-Secrets"],
                     "Metrics": {"UnblendedCost": {"Amount": "0.61"}, "UsageQuantity": {"Amount": "48", "Unit": "Secrets"}}},
                    {"Keys": ["Amazon Elastic Compute Cloud - Compute", "BoxUsage:t3.large"],
                     "Metrics": {"UnblendedCost": {"Amount": "2.0"}, "UsageQuantity": {"Amount": "24", "Unit": "Hrs"}}}]}]}
        subject, message = handler.build_preview(self.now, ce=Ce())
        self.assertEqual(len(calls), 1)
        self.assertIn("PREVIEW", subject)
        self.assertIn("AWS Secrets Manager", message)
        self.assertNotIn("BoxUsage", message)   # EC2 is not a JLT service
        self.assertIn("ACCOUNT TOTAL FOR THE DAY: $2.61", message)


if __name__ == "__main__":
    unittest.main(verbosity=2)
