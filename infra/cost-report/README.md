# JLT daily AWS cost report

Sends a plain-text cost and usage report for Johnson Legal Team (JLT) resources to
`mrtechfixes.ai@gmail.com` every day at 7:00 AM America/Detroit.

```
AWS Data Export (CUR 2.0, daily, resource-level, CSV.GZ)
        -> S3  jlt-cost-exports-<account>   (35-day expiry)
        -> Lambda jlt-cost-report           (Python 3.12, arm64, standard library only)
        -> SNS topic jlt-cost-report        -> email
EventBridge Scheduler jlt-cost-report-daily triggers the Lambda.
```

This folder is not published to the website. `infra/` is listed in `deploy/exclude.txt`.

## What the report contains
- JLT cost for the last complete UTC day, the day before, the previous 7-day average, month to date, and a month-end run-rate.
- The whole-account total for context, so shared costs (worker server, RDS) are visible but not counted as JLT.
- Alerts when JLT cost, or one usage type, is more than twice its recent average.
- Every JLT usage type with its quantity, unit and cost, including free-tier lines at $0.
- The top JLT resources by cost.

"Yesterday" is marked preliminary. AWS can add usage to a day for up to about 48 hours, so the day before is the firmer number.

## What counts as JLT
A cost row is JLT when its resource id contains any string in `patterns.json` (case-insensitive) and none of the
`exclude` strings. The list is stored in SSM parameter `/jlt/cost-report/patterns`. To change it, edit `patterns.json`
and run `./deploy.sh`, or edit the parameter directly. Rows without a resource id (tax, support) are never counted as JLT.
Anything that is not matched appears only in the whole-account total.

## Cost
Target is $0. Data Exports have no charge of their own; S3 holds a few KB per day and expires after 35 days. Lambda,
EventBridge Scheduler, SNS email and SSM standard parameters stay inside the free tier at one run per day. Logs are kept 30 days.
The only billed call anywhere is the optional `preview` mode (one Cost Explorer request, about $0.01).

## Files
| File | Purpose |
|---|---|
| `handler.py` | Lambda code: report mode and preview mode |
| `patterns.json` | JLT scope (resource-id substrings) |
| `template.yaml` | CloudFormation: Lambda, role, SSM parameter, log group, scheduler |
| `setup.sh` | One-time and idempotent: SNS topic and subscription, export bucket, Data Export |
| `deploy.sh` | Runs tests, zips, uploads to the SAM artifact bucket, deploys the stack |
| `test_handler.py` | Unit tests with synthetic export rows (`python3 -m unittest -v`) |

## Setup and deploy
```
./setup.sh      # once. Then click the SNS confirmation link in the email.
./deploy.sh     # whenever code or patterns change
```

## Test
```
# one-off preview. Whole-account numbers from Cost Explorer (about $0.01). Use to check delivery and layout.
aws lambda invoke --function-name jlt-cost-report --cli-binary-format raw-in-base64-out \
  --payload '{"mode":"preview"}' /tmp/out.json

# the real report, using the Data Export (no per-call cost). The first export file arrives within about 24 hours.
aws lambda invoke --function-name jlt-cost-report --cli-binary-format raw-in-base64-out \
  --payload '{"mode":"report"}' /tmp/out.json
```
Before the first export file exists, `report` mode sends a short "no export data yet" message.
A failure sends "JLT AWS cost report FAILED" to the same inbox and also fails the invocation (see log group `/aws/lambda/jlt-cost-report`).

## Pause, change or remove
- Pause: set `State: DISABLED` on the schedule in `template.yaml` and run `./deploy.sh`.
- Change the time: edit `ScheduleExpression` and `ScheduleTimezone` defaults in `template.yaml`.
- Remove: delete the stack `jlt-cost-report`, delete the export `jlt-cur2-daily` (`aws bcm-data-exports delete-export`),
  then empty and delete the bucket and the SNS topic created by `setup.sh`.

## Notes
- Usage days in the export are UTC days.
- The export is `OVERWRITE_REPORT`, so each day's refresh replaces the previous file instead of adding copies.
- The Lambda role can read only `cur/*` in the export bucket, publish only to this topic, read one SSM parameter, and call
  `ce:GetCostAndUsage` (preview mode only).
