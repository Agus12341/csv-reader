[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Agus12341/csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Agus12341/csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader — a faster drop-in for csv-reader 1.0.0

An entry for make.fun's [Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121) bounty.

`solve.js` exports `run(input)`, which returns exactly the answer
csv-reader 1.0.0 returns for a case's input `{text, header}` — the JSON
value `{columns, rows, errors}` — under csv-reader's own broken-row
policy: a leading U+FEFF dropped, records ending at LF or CRLF, blank
lines skipped, a lone CR outside quotes dropped (`stray_cr`), quoted
fields with `""` escapes and CR/CRLF read as LF inside them, junk after a
closing quote appended as it stands (`quote_junk`), a quote that never
closes re-read as a literal character (`unterminated_quote`), and every
row padded or cut to the first record's width (`short_row` / `long_row`).

Where the reference builds each field a character at a time, this reader
works in stretches: unquoted fields are taken as single slices between
delimiters, quoted fields advance by `indexOf` jumps from quote to quote,
and only the rare stretch that actually contains a CR is walked
character by character to normalise its line breaks. Nothing is kept
from one call to the next.

`main.ts` is the driver the harness runs: it reads `/input/cases.json`,
answers each case with `run`, and writes `/output/answers.json`.

## Layout

- `main.ts` — the harness driver
- `solve.js` — the reader itself (dependency-free ES module)

## License

MIT — see `LICENSE`.
