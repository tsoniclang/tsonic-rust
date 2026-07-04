//! Oracle-backed backtracking RegExp engine for a closed JS subset.
//!
//! Supported syntax: literal chars, `.`, character classes (`[abc]`,
//! `[a-z]`, `[^...]`), class escapes `\d \D \w \W \s \S` (inside and outside
//! classes), identity/control/hex escapes (`\.`, `\\`, `\n`, `\t`, `\xHH`,
//! `\uHHHH`, ...), greedy quantifiers `* + ? {n} {n,} {n,m}`, anchors `^ $`,
//! alternation `|`, capturing `( )` and non-capturing `(?: )` groups.
//! Supported flags: `i`, `g` (drives `replace`/`split` iteration and the
//! stateful `exec`/`lastIndex` contract), `m`.
//!
//! Everything else — lazy quantifiers, backreferences, lookaround, named
//! groups, `\b`/`\B` assertions, property escapes, and the flags
//! `d s u v y` — is rejected at construction with a `SyntaxError` naming the
//! construct. Acceptance of the supported subset is proven against Node's
//! engine by the committed oracle vectors in `tests/oracle/`.
//!
//! The accepted subset is exact. The one construct/input combination that
//! cannot be represented is empty-match iteration over astral input: after an
//! empty match JS advances by one UTF-16 code unit, which can land inside a
//! surrogate pair — a position a Rust `String` cannot express. The iterating
//! operations (`replace` with `g`, `split`, `match_strings`, `match_all`)
//! therefore reject deterministically with an `Unsupported` error when the
//! pattern is nullable (can match the empty string) and the input contains
//! astral (non-BMP) chars. Non-nullable patterns over astral input and
//! nullable patterns over BMP input keep exact oracle-proven behavior.

mod parser;
mod vm;

use crate::errors::{type_error, unsupported, JsResult};

/// Match carrier mirroring the JS `RegExpMatchArray` shape: the whole match
/// (`text`), its UTF-16 code-unit `index`, the `input` searched, and the
/// capture groups (`group(1)`..`group(group_count())`, `group(0)` being the
/// whole match, `None` for unmatched optional groups).
#[derive(Debug, Clone, PartialEq)]
pub struct JsRegExpMatch {
    text: String,
    index: i32,
    input: String,
    groups: Vec<Option<String>>,
}

impl JsRegExpMatch {
    /// The whole matched substring (JS `m[0]`).
    pub fn text(&self) -> String {
        self.text.clone()
    }

    /// UTF-16 code-unit index of the match start (JS `m.index`).
    pub fn index(&self) -> i32 {
        self.index
    }

    /// The input string that was searched (JS `m.input`).
    pub fn input(&self) -> String {
        self.input.clone()
    }

    /// Capture group by 1-based index like JS `m[i]`; `group(0)` is the whole
    /// match. Returns `None` for unmatched groups and out-of-range indexes.
    pub fn group(&self, index: usize) -> Option<String> {
        if index == 0 {
            return Some(self.text.clone());
        }
        self.groups.get(index - 1).cloned().flatten()
    }

    /// Number of capture groups in the pattern, excluding group 0.
    pub fn group_count(&self) -> usize {
        self.groups.len()
    }
}

#[derive(Debug, Clone)]
pub struct JsRegExp {
    source: String,
    flags: String,
    global: bool,
    ignore_case: bool,
    multiline: bool,
    last_index: i32,
    nullable: bool,
    program: vm::Program,
}

impl JsRegExp {
    /// Compiles `pattern` with `flags`, rejecting anything outside the
    /// supported subset with a `SyntaxError`.
    pub fn new(pattern: &str, flags: &str) -> JsResult<Self> {
        let parsed_flags = parser::parse_flags(flags)?;
        let parsed = parser::parse_pattern(pattern)?;
        let nullable = parser::is_nullable(&parsed.ast);
        let program = vm::compile(&parsed);
        Ok(Self {
            source: pattern.to_string(),
            flags: flags.to_string(),
            global: parsed_flags.global,
            ignore_case: parsed_flags.ignore_case,
            multiline: parsed_flags.multiline,
            last_index: 0,
            nullable,
            program,
        })
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn flags(&self) -> &str {
        &self.flags
    }

    /// Whether the `g` flag is set (JS `regexp.global`).
    pub fn global(&self) -> bool {
        self.global
    }

    /// Whether the `i` flag is set (JS `regexp.ignoreCase`).
    pub fn ignore_case(&self) -> bool {
        self.ignore_case
    }

    /// Whether the `m` flag is set (JS `regexp.multiline`).
    pub fn multiline(&self) -> bool {
        self.multiline
    }

    /// Current `lastIndex` in UTF-16 code units (only consulted by `exec`
    /// when the `g` flag is set, per JS semantics).
    pub fn last_index(&self) -> i32 {
        self.last_index
    }

    /// Sets `lastIndex` (JS `regexp.lastIndex = value`).
    pub fn set_last_index(&mut self, value: i32) {
        self.last_index = value;
    }

    /// Mirrors `RegExp.prototype.exec`. With the `g` flag the search starts
    /// at `lastIndex` (UTF-16 code units) and `lastIndex` advances to the
    /// match end, or resets to 0 when no match is found; without `g` the
    /// search always starts at 0 and `lastIndex` is untouched.
    pub fn exec(&mut self, input: &str) -> Option<JsRegExpMatch> {
        let chars: Vec<char> = input.chars().collect();
        let start = if self.global {
            let last = self.last_index.max(0) as usize;
            match char_index_for_utf16(&chars, last) {
                Some(index) => index,
                None => {
                    self.last_index = 0;
                    return None;
                }
            }
        } else {
            0
        };
        match self.find_from(&chars, start) {
            Some(caps) => {
                if self.global {
                    self.last_index = utf16_index(&chars, match_bounds(&caps).1) as i32;
                }
                Some(build_match(&chars, input, &caps, self.program_groups()))
            }
            None => {
                if self.global {
                    self.last_index = 0;
                }
                None
            }
        }
    }

    /// Stateless first match (JS `String.prototype.match` without `g`,
    /// ignoring `lastIndex`).
    pub fn match_first(&self, input: &str) -> Option<JsRegExpMatch> {
        let chars: Vec<char> = input.chars().collect();
        let caps = self.find_from(&chars, 0)?;
        Some(build_match(&chars, input, &caps, self.program_groups()))
    }

    /// Mirrors `String.prototype.match` with the `g` flag: the texts of all
    /// matches, or `None` when there is no match (JS `null`). Stateless.
    /// Rejects nullable patterns over astral input (see the module docs).
    pub fn match_strings(&self, input: &str) -> JsResult<Option<Vec<String>>> {
        self.check_empty_match_iteration(input)?;
        let chars: Vec<char> = input.chars().collect();
        let texts: Vec<String> = self
            .collect_matches(&chars)
            .iter()
            .map(|caps| {
                let (start, end) = match_bounds(caps);
                chars[start..end].iter().collect()
            })
            .collect();
        Ok(if texts.is_empty() { None } else { Some(texts) })
    }

    /// Mirrors `String.prototype.matchAll`: `TypeError` when the regexp lacks
    /// the `g` flag, otherwise all matches (stateless; JS clones the regexp).
    pub fn match_all(&self, input: &str) -> JsResult<Vec<JsRegExpMatch>> {
        if !self.global {
            return Err(type_error(
                "String.prototype.matchAll called with a non-global RegExp argument",
            ));
        }
        self.check_empty_match_iteration(input)?;
        let chars: Vec<char> = input.chars().collect();
        Ok(self
            .collect_matches(&chars)
            .iter()
            .map(|caps| build_match(&chars, input, caps, self.program_groups()))
            .collect())
    }

    /// All non-overlapping matches from the start, advancing past empty
    /// matches by one char. Callers guard the nullable-pattern/astral-input
    /// combination via `check_empty_match_iteration`, so advancing by one
    /// char here is exactly JS's one UTF-16 code unit.
    fn collect_matches(&self, chars: &[char]) -> Vec<Vec<Option<usize>>> {
        let mut out = Vec::new();
        let mut from = 0_usize;
        while let Some(caps) = self.find_from(chars, from) {
            let (start, end) = match_bounds(&caps);
            from = if end == start { end + 1 } else { end };
            out.push(caps);
            if from > chars.len() {
                break;
            }
        }
        out
    }

    /// Mirrors `RegExp.prototype.test`, which delegates to `exec`: with the
    /// `g` flag the search starts at `lastIndex`, which advances to the match
    /// end (UTF-16 code units) on success and resets to 0 on failure; without
    /// `g` the call is stateless and ignores `lastIndex`.
    pub fn test(&mut self, input: &str) -> bool {
        self.exec(input).is_some()
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
    /// substitutions `$$`, `$&`, `` $` ``, `$'` and `$1`..`$99`. With `g` it
    /// rejects nullable patterns over astral input (see the module docs); a
    /// non-`g` replace never iterates empty matches and is always `Ok`.
    pub fn replace(&self, input: &str, replacement: &str) -> JsResult<String> {
        if self.global {
            self.check_empty_match_iteration(input)?;
        }
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
        Ok(out)
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
        self.check_empty_match_iteration(input)?;
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

    /// Fail-closed guard for the iterating operations: a nullable pattern
    /// (one that can match the empty string) over astral input would require
    /// advancing one UTF-16 code unit past an empty match — a mid-surrogate
    /// position no Rust `String` can express — so it is rejected up front
    /// instead of diverging from JS.
    fn check_empty_match_iteration(&self, input: &str) -> JsResult<()> {
        if self.nullable && input.chars().any(|value| value > '\u{ffff}') {
            return Err(unsupported(
                "empty-match iteration over astral input diverges from UTF-16 semantics",
            ));
        }
        Ok(())
    }

    fn exec_anchored(&self, chars: &[char], at: usize) -> Option<Vec<Option<usize>>> {
        vm::exec_at(&self.program, chars, at, self.ignore_case, self.multiline)
    }

    fn find_from(&self, chars: &[char], start: usize) -> Option<Vec<Option<usize>>> {
        (start..=chars.len()).find_map(|at| self.exec_anchored(chars, at))
    }
}

/// UTF-16 code-unit offset of char index `at`.
fn utf16_index(chars: &[char], at: usize) -> usize {
    chars[..at].iter().map(|value| value.len_utf16()).sum()
}

/// Char index for a UTF-16 code-unit offset; `None` when the offset lies
/// beyond the end of `chars`. An offset inside an astral char resolves to the
/// following char boundary (the engine cannot start mid-surrogate).
fn char_index_for_utf16(chars: &[char], utf16: usize) -> Option<usize> {
    let mut units = 0_usize;
    for (index, value) in chars.iter().enumerate() {
        if units >= utf16 {
            return Some(index);
        }
        units += value.len_utf16();
    }
    (units >= utf16).then_some(chars.len())
}

fn build_match(
    chars: &[char],
    input: &str,
    caps: &[Option<usize>],
    group_count: usize,
) -> JsRegExpMatch {
    let (start, end) = match_bounds(caps);
    let groups = (1..=group_count)
        .map(|group| match (caps[2 * group], caps[2 * group + 1]) {
            (Some(from), Some(to)) => Some(chars[from..to].iter().collect()),
            _ => None,
        })
        .collect();
    JsRegExpMatch {
        text: chars[start..end].iter().collect(),
        index: utf16_index(chars, start) as i32,
        input: input.to_string(),
        groups,
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
