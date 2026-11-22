// A fast drop-in replacement for csv-reader 1.0.0's readCsv.
//
// It answers exactly as csv-reader does on every input — the same
// {columns, rows, errors} for the same {text, header} — but reads the text
// with index jumps and whole-field slices where the reference builds every
// field a character at a time.
//
// The reading policy, matched behaviour for behaviour:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no
//     record at all (but stray-CR errors met on such a line stay recorded);
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled ("" inside it is one quote), each CRLF or lone CR inside it is
//     read as one LF; whatever follows the closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, recorded
//     when the field ends, if anything was appended);
//   - a quote that never closes is a literal character and the text after
//     it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null (and []
//     when header is true but there are no records); rows holds the records
//     after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based
//     line its record starts on (every LF, CRLF and lone CR inside quotes
//     counted), row its record's index in rows, null for the header.
//
// Pure: nothing is kept from one call to the next.

const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_EOF = 2;

export function run(input) {
  const s = String(input.text);
  const header = input.header === true;
  const n = s.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let i = 0; // the next character to read
  let line = 1; // the line that character is on
  if (s.charCodeAt(0) === 0xfeff) i = 1;

  // The record being read: every error it meets is filed under these two.
  let recLine = 1;
  let recRow = null;

  // The field just read: its value, how it ended, and how many of its
  // characters the last plain scan kept (quote_junk is judged by it). The
  // scanners write these instead of returning a tuple, so a field costs no
  // result object.
  let fValue = '';
  let fEnded = ENDED_EOF;
  let fAdded = 0;

  function fail(code) {
    errors.push({ code, line: recLine, row: recRow });
  }

  // Reads unquoted characters onto `pre` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr).
  function scanPlain(pre) {
    let parts = null; // value slices, once a stray CR has split the value
    let seg = i; // the start of the slice not yet taken
    let added = 0;
    for (;;) {
      let j = i;
      while (j < n) {
        const c = s.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13) break;
        j++;
      }
      if (j >= n) {
        added += j - seg;
        const tail = s.slice(seg, j);
        i = n;
        fValue = parts === null ? pre + tail : pre + parts.join('') + tail;
        fEnded = ENDED_EOF;
        fAdded = added;
        return;
      }
      const c = s.charCodeAt(j);
      if (c === 44) {
        added += j - seg;
        const tail = s.slice(seg, j);
        i = j + 1;
        fValue = parts === null ? pre + tail : pre + parts.join('') + tail;
        fEnded = ENDED_COMMA;
        fAdded = added;
        return;
      }
      if (c === 10 || s.charCodeAt(j + 1) === 10) {
        // LF, or CR with LF after it: the record ends here.
        added += j - seg;
        const tail = s.slice(seg, j);
        i = j + (c === 10 ? 1 : 2);
        line++;
        fValue = parts === null ? pre + tail : pre + parts.join('') + tail;
        fEnded = ENDED_BREAK;
        fAdded = added;
        return;
      }
      // A lone CR: dropped, and the scan goes on past it.
      fail('stray_cr');
      if (parts === null) parts = [];
      parts.push(s.slice(seg, j));
      added += j - seg;
      i = j + 1;
      seg = i;
    }
  }

  // The raw stretch s[a..b) inside a quoted field, with each CRLF or lone
  // CR read as one LF; `line` is advanced past every break in it.
  function quotedStretch(a, b) {
    const out = [];
    let seg = a;
    let j = a;
    while (j < b) {
      const c = s.charCodeAt(j);
      if (c === 13) {
        out.push(s.slice(seg, j), '\n');
        line++;
        j += s.charCodeAt(j + 1) === 10 ? 2 : 1;
        seg = j;
      } else {
        if (c === 10) line++;
        j++;
      }
    }
    out.push(s.slice(seg, b));
    return out.join('');
  }

  // Reads a field whose opening quote is at i.
  function scanQuoted() {
    const open = i;
    const openLine = line;
    i++; // past the opening quote
    let parts = null; // value pieces, once a doubled quote splits the value
    let seg = i; // the start of the stretch not yet taken
    for (;;) {
      const q = s.indexOf('"', i);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        i = open + 1;
        line = openLine;
        fail('unterminated_quote');
        scanPlain('"');
        return;
      }
      // The stretch [seg, q): find its first CR, counting LFs on the way.
      let lfs = 0;
      let cr = -1;
      for (let j = seg; j < q; j++) {
        const c = s.charCodeAt(j);
        if (c === 10) lfs++;
        else if (c === 13) {
          cr = j;
          break;
        }
      }
      let stretch;
      if (cr === -1) {
        line += lfs;
        stretch = s.slice(seg, q);
      } else {
        stretch = quotedStretch(seg, q);
      }
      if (s.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote in the value.
        if (parts === null) parts = [stretch, '"'];
        else parts.push(stretch, '"');
        i = q + 2;
        seg = i;
        continue;
      }
      // The closing quote.
      const value = parts === null ? stretch : parts.join('') + stretch;
      i = q + 1;
      if (i >= n) {
        fValue = value;
        fEnded = ENDED_EOF;
        return;
      }
      const c = s.charCodeAt(i);
      if (c === 44) {
        i++;
        fValue = value;
        fEnded = ENDED_COMMA;
        return;
      }
      if (c === 10) {
        i++;
        line++;
        fValue = value;
        fEnded = ENDED_BREAK;
        return;
      }
      if (c === 13 && s.charCodeAt(i + 1) === 10) {
        i += 2;
        line++;
        fValue = value;
        fEnded = ENDED_BREAK;
        return;
      }
      // What follows the closing quote is appended as it stands.
      scanPlain(value);
      if (fAdded > 0) fail('quote_junk');
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 10) {
        i++;
        line++;
      } else if (c === 13 && s.charCodeAt(i + 1) === 10) {
        i += 2;
        line++;
      } else {
        break;
      }
    }
    if (i >= n) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      if (s.charCodeAt(i) === 34) {
        quoted = true;
        scanQuoted();
      } else {
        quoted = false;
        scanPlain('');
      }
      fields.push(fValue);
    } while (fEnded === ENDED_COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? columns ?? [] : null, rows, errors };
}
