# duration

`parseDuration(str)` returns a number of seconds.

- Components are a number followed by a unit: s (seconds), m (minutes), h (hours), d (days). Units are case-insensitive.
- Numbers may have a decimal part: "1.5h" is 5400.
- Several components add up, in any order, with optional whitespace between them: "1h30m", "2d 4h", "30m1h".
- Leading and trailing whitespace is ignored.
- A bare number with no unit means seconds: "90" is 90.
- Anything else (empty string, no digits, a unit without a number, negative numbers, unknown units, trailing junk) throws RangeError with the message `invalid duration: <input>`.
- A non-string argument throws TypeError.
