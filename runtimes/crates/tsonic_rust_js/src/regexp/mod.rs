//! Oracle-backed backtracking RegExp engine for a closed JS subset.
//!
//! Supported syntax: literal chars, `.`, character classes (`[abc]`,
//! `[a-z]`, `[^...]`), class escapes `\d \D \w \W \s \S` (inside and outside
//! classes), identity/control/hex escapes (`\.`, `\\`, `\n`, `\t`, `\xHH`,
//! `\uHHHH`, ...), greedy quantifiers `* + ? {n} {n,} {n,m}`, anchors `^ $`,
//! alternation `|`, capturing `( )` and non-capturing `(?: )` groups.
//! Supported flags: `i`, `g` (drives `replace`/`split` iteration), `m`.
//!
//! Everything else — lazy quantifiers, backreferences, lookaround, named
//! groups, `\b`/`\B` assertions, property escapes, and the flags
//! `d s u v y` — is rejected at construction with a `SyntaxError` naming the
//! construct. Acceptance of the supported subset is proven against Node's
//! engine by the committed oracle vectors in `tests/oracle/`.
//!
//! Known deviation: `replace` (with `g`) and `split` advance by one Unicode
//! scalar value after an empty match, where JS advances by one UTF-16 code
//! unit; this differs only for astral-plane (non-BMP) chars.

mod parser;
mod vm;

use crate::errors::{unsupported, JsResult};

#[derive(Debug, Clone)]
pub struct JsRegExp {
    source: String,
    flags: String,
    global: bool,
    ignore_case: bool,
    multiline: bool,
    program: vm::Program,
}

impl JsRegExp {
    /// Compiles `pattern` with `flags`, rejecting anything outside the
    /// supported subset with a `SyntaxError`.
    pub fn new(pattern: &str, flags: &str) -> JsResult<Self> {
        let parsed_flags = parser::parse_flags(flags)?;
        let parsed = parser::parse_pattern(pattern)?;
        let program = vm::compile(&parsed);
        Ok(Self {
            source: pattern.to_string(),
            flags: flags.to_string(),
            global: parsed_flags.global,
            ignore_case: parsed_flags.ignore_case,
            multiline: parsed_flags.multiline,
            program,
        })
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn flags(&self) -> &str {
        &self.flags
    }

    /// Mirrors `RegExp.prototype.test` (stateless: always searches from the
    /// start of `input`).
    pub fn test(&self, input: &str) -> bool {
        let chars: Vec<char> = input.chars().collect();
        self.find_from(&chars, 0).is_some()
    }

    /// Byte offsets `(start, end)` of the first match in `input`.
    pub fn find_first(&self, input: &str) -> Option<(usize, usize)> {
        let chars: Vec<char> = input.chars().collect();
        let caps = self.find_from(&chars, 0)?;
        let (start, end) = match_bounds(&caps);
        let mut byte = 0_usize;
        let mut byte_start = 0_usize;
        for (index, value) in chars.iter().enumerate() {
            if index == start {
                byte_start = byte;
            }
            if index == end {
                return Some((byte_start, byte));
            }
            byte += value.len_utf8();
        }
        if start == chars.len() {
            byte_start = byte;
        }
        Some((byte_start, byte))
    }

    /// Mirrors `String.prototype.replace(regexp, replacement)` with a string
    /// replacement: first match only unless the `g` flag is set. Supports the
    /// substitutions `$$`, `$&`, `` $` ``, `$'` and `$1`..`$99`.
    pub fn replace(&self, input: &str, replacement: &str) -> String {
        let chars: Vec<char> = input.chars().collect();
        let mut out = String::new();
        let mut last = 0_usize;
        let mut from = 0_usize;
        while let Some(caps) = self.find_from(&chars, from) {
            let (start, end) = match_bounds(&caps);
            out.extend(&chars[last..start]);
            expand_replacement(&mut out, replacement, &chars, &caps, self.program_groups());
            last = end;
            if !self.global {
                break;
            }
            from = if end == start { end + 1 } else { end };
            if from > chars.len() {
                break;
            }
        }
        out.extend(&chars[last..]);
        out
    }

    /// Mirrors `String.prototype.split(regexp)` without a limit argument,
    /// including the spec's empty-match handling. Patterns with capturing
    /// groups are rejected because JS splices capture values into the result;
    /// use a non-capturing group `(?:...)` instead.
    pub fn split(&self, input: &str) -> JsResult<Vec<String>> {
        if self.program_groups() > 0 {
            return Err(unsupported(
                "split with capturing groups is not supported; use a non-capturing group `(?:...)`",
            ));
        }
        let chars: Vec<char> = input.chars().collect();
        let size = chars.len();
        if size == 0 {
            return Ok(if self.exec_anchored(&chars, 0).is_some() {
                Vec::new()
            } else {
                vec![String::new()]
            });
        }
        let mut out = Vec::new();
        let mut segment_start = 0_usize;
        let mut cursor = 0_usize;
        while cursor < size {
            match self.exec_anchored(&chars, cursor) {
                None => cursor += 1,
                Some(caps) => {
                    let end = match_bounds(&caps).1.min(size);
                    if end == segment_start {
                        cursor += 1;
                    } else {
                        out.push(chars[segment_start..cursor].iter().collect());
                        segment_start = end;
                        cursor = end;
                    }
                }
            }
        }
        out.push(chars[segment_start..size].iter().collect());
        Ok(out)
    }

    /// Mirrors `String.prototype.search`: the UTF-16 code-unit index of the
    /// first match, or -1.
    pub fn search(&self, input: &str) -> i32 {
        let chars: Vec<char> = input.chars().collect();
        match self.find_from(&chars, 0) {
            Some(caps) => chars[..match_bounds(&caps).0]
                .iter()
                .map(|value| value.len_utf16())
                .sum::<usize>() as i32,
            None => -1,
        }
    }

    fn program_groups(&self) -> usize {
        self.program.group_count
    }

    fn exec_anchored(&self, chars: &[char], at: usize) -> Option<Vec<Option<usize>>> {
        vm::exec_at(&self.program, chars, at, self.ignore_case, self.multiline)
    }

    fn find_from(&self, chars: &[char], start: usize) -> Option<Vec<Option<usize>>> {
        (start..=chars.len()).find_map(|at| self.exec_anchored(chars, at))
    }
}

fn match_bounds(caps: &[Option<usize>]) -> (usize, usize) {
    (
        caps[0].expect("match start recorded"),
        caps[1].expect("match end recorded"),
    )
}

fn expand_replacement(
    out: &mut String,
    replacement: &str,
    chars: &[char],
    caps: &[Option<usize>],
    group_count: usize,
) {
    let (start, end) = match_bounds(caps);
    let rep: Vec<char> = replacement.chars().collect();
    let mut index = 0_usize;
    while index < rep.len() {
        let current = rep[index];
        if current != '$' || index + 1 >= rep.len() {
            out.push(current);
            index += 1;
            continue;
        }
        match rep[index + 1] {
            '$' => {
                out.push('$');
                index += 2;
            }
            '&' => {
                out.extend(&chars[start..end]);
                index += 2;
            }
            '`' => {
                out.extend(&chars[..start]);
                index += 2;
            }
            '\'' => {
                out.extend(&chars[end..]);
                index += 2;
            }
            digit @ '0'..='9' => {
                let first = digit.to_digit(10).expect("decimal digit") as usize;
                let two_digit = rep
                    .get(index + 2)
                    .and_then(|next| next.to_digit(10))
                    .map(|second| first * 10 + second as usize);
                let (group, consumed) = match two_digit {
                    Some(number) if (1..=group_count).contains(&number) => (number, 3),
                    _ if (1..=group_count).contains(&first) => (first, 2),
                    _ => (0, 0),
                };
                if consumed == 0 {
                    out.push('$');
                    index += 1;
                } else {
                    if let (Some(from), Some(to)) = (caps[2 * group], caps[2 * group + 1]) {
                        out.extend(&chars[from..to]);
                    }
                    index += consumed;
                }
            }
            _ => {
                out.push('$');
                index += 1;
            }
        }
    }
}
