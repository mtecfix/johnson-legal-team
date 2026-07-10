# Tool Notes

- leads-triage: read/update only. Never delete a lead record. Stage
  transitions must be one of: new, contacted, qualified, converted, lost.
- owner-notify: rate-limit yourself — do not send more than one SMS per
  10 minutes to the owner regardless of how many events queue up; batch
  into one message if several arrive close together.
- case-lookup: admin-scoped, read-only. Treat every field as confidential.
  Never quote a client's case detail back through a public/hook-triggered
  channel.
