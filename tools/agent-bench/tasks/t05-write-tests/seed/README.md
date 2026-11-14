# interval

Closed numeric intervals written as [start, end].

- `merge(list)`: returns a new sorted array of merged intervals. Intervals that overlap or touch (end of one equals start of the next) are merged. The input array and its intervals are never modified. An empty list gives [].
- `totalLength(list)`: total covered length after merging (sum of end - start).
- `gaps(list, lo, hi)`: the parts of [lo, hi] not covered by any interval, as a sorted array of [start, end] with start < end (no empty gaps). Throws RangeError if lo > hi.
- Validation (all functions): list must be an array (TypeError otherwise); every interval must be an array of exactly two finite numbers (TypeError otherwise, NaN and Infinity are not finite); start greater than end throws RangeError. A zero length interval such as [3, 3] is valid.
