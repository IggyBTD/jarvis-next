# cron

Next-run times for the scheduler (server/core/scheduler in JARVIS). A schedule has five fields: minute (0-59), hour (0-23), day of month (1-31), month (1-12), day of week (0-7, where 0 and 7 are both Sunday).

- Each field is a comma list of items. An item is `*`, `N`, `N-M`, `*/S`, `N/S` (from N up to the field's maximum, every S), or `N-M/S`. A step must be 1 or more. Numbers must be inside the field's range.
- Anything else in a field is an error: throw an `Error`.
- The expression must have exactly five fields. Leading and trailing spaces are allowed; any amount of space between fields is allowed.
- Day rule: if the day-of-month field starts with `*`, only the day of week counts. If the day-of-week field starts with `*`, only the day of month counts. If neither starts with `*`, a day matches when either field matches.
- `nextRun(expr, from)` returns a `Date`: the first matching minute strictly after `from`, with seconds and milliseconds dropped. All times are UTC.
- If nothing matches within five years (for example day 30 of February), throw an `Error`.
