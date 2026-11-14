# tinycsv (cli.js)

Input files are CSV with a header row. Fields may be quoted with double quotes; inside quotes a comma, a newline, or a doubled quote ("") is literal. Line endings can be LF or CRLF. A trailing newline at the end of the file does not make an extra row. Rows are objects keyed by header name.

## Part 1

`node cli.js stats <file> --col <name>`
Prints exactly four lines for the numeric values of that column (empty cells and non-numeric cells are ignored):
```
count=<n>
min=<number>
max=<number>
mean=<number with exactly 2 decimals>
```
If there are no numeric values, print only `count=0`.

`node cli.js filter <file> --col <name> --eq <value>`
Prints the header row and every row whose cell in that column equals <value> exactly, as CSV. A field is written in quotes (with " doubled) only if it contains a comma, a double quote or a newline. Lines end with LF.

Errors (all commands): print the message to stderr and exit with code 2.
- unknown column: `no such column: <name>`
- unreadable file: `cannot read <file>`
- unknown command: `unknown command: <name>`

## Part 2

`stats` gains `--group-by <col>`: instead of the four lines, print one line per distinct value of <col>, sorted by that value ascending (plain string comparison), in the form
`<group>\tcount=<n>,min=<number>,max=<number>,mean=<2 decimals>` (a TAB after the group). A group with no numeric values prints `<group>\tcount=0`. Unknown group column is the same `no such column` error.

`stats` and `filter` gain `--format json`:
- `stats` prints one JSON object `{"count":n,"min":x,"max":y,"mean":m}` where mean is a number rounded to 2 decimals (when count is 0 only `{"count":0}`). With `--group-by` it prints a JSON array of such objects, each with a leading `"group"` key, sorted by group.
- `filter` prints a JSON array of row objects (all values are strings), in file order.
Both end with a single LF.

New command `node cli.js sort <file> --col <name> [--desc]`
Prints the header and all rows as CSV (same quoting rules as `filter`) sorted by that column. If every non-empty value in the column is numeric, compare numerically, otherwise compare as strings. Empty cells always go last, also with `--desc`. The sort is stable.
