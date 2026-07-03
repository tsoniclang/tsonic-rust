//! Pattern and flag parser for the closed RegExp subset.
//!
//! Everything outside the supported subset is rejected deterministically at
//! construction time with a `SyntaxError` naming the offending construct.

use crate::errors::{syntax_error, JsResult};

/// Upper bound for `{n}` / `{n,}` / `{n,m}` quantifier operands. Bounded
/// repeats are expanded at compile time, so the subset caps the operands.
const MAX_QUANTIFIER_BOUND: u32 = 1000;

#[derive(Debug, Clone)]
pub(crate) enum Ast {
    Alternation(Vec<Ast>),
    Concat(Vec<Ast>),
    Char(char),
    Dot,
    Class(ClassSpec),
    Group {
        index: Option<u32>,
        body: Box<Ast>,
    },
    Repeat {
        body: Box<Ast>,
        min: u32,
        max: Option<u32>,
    },
    AnchorStart,
    AnchorEnd,
}

#[derive(Debug, Clone)]
pub(crate) struct ClassSpec {
    pub(crate) negated: bool,
    pub(crate) items: Vec<ClassItem>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum ClassItem {
    Single(char),
    Range(char, char),
    Digit,
    NotDigit,
    Word,
    NotWord,
    Space,
    NotSpace,
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedPattern {
    pub(crate) ast: Ast,
    pub(crate) group_count: u32,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ParsedFlags {
    pub(crate) ignore_case: bool,
    pub(crate) global: bool,
    pub(crate) multiline: bool,
}

pub(crate) fn parse_flags(flags: &str) -> JsResult<ParsedFlags> {
    let mut parsed = ParsedFlags::default();
    for flag in flags.chars() {
        let slot = match flag {
            'i' => &mut parsed.ignore_case,
            'g' => &mut parsed.global,
            'm' => &mut parsed.multiline,
            _ => {
                return Err(syntax_error(format!(
                    "RegExp flag `{flag}` is not supported"
                )))
            }
        };
        if *slot {
            return Err(syntax_error(format!("duplicate RegExp flag `{flag}`")));
        }
        *slot = true;
    }
    Ok(parsed)
}

pub(crate) fn parse_pattern(pattern: &str) -> JsResult<ParsedPattern> {
    let mut parser = Parser {
        chars: pattern.chars().collect(),
        pos: 0,
        group_count: 0,
    };
    let ast = parser.parse_alternation()?;
    if parser.pos < parser.chars.len() {
        return Err(syntax_error("unmatched `)` in RegExp pattern"));
    }
    Ok(ParsedPattern {
        ast,
        group_count: parser.group_count,
    })
}

enum ClassMember {
    Char(char),
    Item(ClassItem),
}

struct Parser {
    chars: Vec<char>,
    pos: usize,
    group_count: u32,
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn peek_at(&self, offset: usize) -> Option<char> {
        self.chars.get(self.pos + offset).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let next = self.peek();
        if next.is_some() {
            self.pos += 1;
        }
        next
    }

    fn eat(&mut self, expected: char) -> bool {
        if self.peek() == Some(expected) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn parse_alternation(&mut self) -> JsResult<Ast> {
        let mut branches = vec![self.parse_concat()?];
        while self.eat('|') {
            branches.push(self.parse_concat()?);
        }
        if branches.len() == 1 {
            Ok(branches.pop().expect("single branch"))
        } else {
            Ok(Ast::Alternation(branches))
        }
    }

    fn parse_concat(&mut self) -> JsResult<Ast> {
        let mut items = Vec::new();
        while let Some(next) = self.peek() {
            if next == '|' || next == ')' {
                break;
            }
            items.push(self.parse_term()?);
        }
        if items.len() == 1 {
            Ok(items.pop().expect("single item"))
        } else {
            Ok(Ast::Concat(items))
        }
    }

    fn parse_term(&mut self) -> JsResult<Ast> {
        let atom = self.parse_atom()?;
        let Some((min, max)) = self.parse_quantifier()? else {
            return Ok(atom);
        };
        if matches!(atom, Ast::AnchorStart | Ast::AnchorEnd) {
            return Err(syntax_error(
                "quantifier on `^`/`$` anchor is not supported",
            ));
        }
        Ok(Ast::Repeat {
            body: Box::new(atom),
            min,
            max,
        })
    }

    fn parse_atom(&mut self) -> JsResult<Ast> {
        let next = self.bump().expect("caller checked for input");
        match next {
            '^' => Ok(Ast::AnchorStart),
            '$' => Ok(Ast::AnchorEnd),
            '.' => Ok(Ast::Dot),
            '(' => self.parse_group(),
            '[' => self.parse_class().map(Ast::Class),
            '\\' => self.parse_escape_atom(),
            '*' | '+' | '?' => Err(syntax_error(format!(
                "quantifier `{next}` has nothing to repeat"
            ))),
            '{' => Err(syntax_error("bare `{` is not supported in RegExp pattern")),
            '}' => Err(syntax_error("bare `}` is not supported in RegExp pattern")),
            _ => Ok(Ast::Char(next)),
        }
    }

    fn parse_group(&mut self) -> JsResult<Ast> {
        let index = if self.eat('?') {
            match self.peek() {
                Some(':') => {
                    self.pos += 1;
                    None
                }
                Some('=') => return Err(syntax_error("lookahead `(?=` is not supported")),
                Some('!') => return Err(syntax_error("negative lookahead `(?!` is not supported")),
                Some('<') => {
                    return Err(match self.peek_at(1) {
                        Some('=') => syntax_error("lookbehind `(?<=` is not supported"),
                        Some('!') => syntax_error("negative lookbehind `(?<!` is not supported"),
                        _ => syntax_error("named capture group `(?<name>` is not supported"),
                    })
                }
                _ => return Err(syntax_error("unrecognized group modifier after `(?`")),
            }
        } else {
            self.group_count += 1;
            Some(self.group_count)
        };
        let body = self.parse_alternation()?;
        if !self.eat(')') {
            return Err(syntax_error("unterminated group: missing `)`"));
        }
        Ok(Ast::Group {
            index,
            body: Box::new(body),
        })
    }

    fn parse_quantifier(&mut self) -> JsResult<Option<(u32, Option<u32>)>> {
        let (bounds, label) = match self.peek() {
            Some('*') => {
                self.pos += 1;
                ((0, None), "*?")
            }
            Some('+') => {
                self.pos += 1;
                ((1, None), "+?")
            }
            Some('?') => {
                self.pos += 1;
                ((0, Some(1)), "??")
            }
            Some('{') => match self.parse_braced_quantifier()? {
                Some(bounds) => (bounds, "{n,m}?"),
                None => return Err(syntax_error("bare `{` is not supported in RegExp pattern")),
            },
            _ => return Ok(None),
        };
        if self.peek() == Some('?') {
            return Err(syntax_error(format!(
                "lazy quantifier `{label}` is not supported"
            )));
        }
        Ok(Some(bounds))
    }

    /// Parses `{n}`, `{n,}` or `{n,m}` starting at the `{`. Returns `None`
    /// when the braces do not form a well-formed quantifier.
    fn parse_braced_quantifier(&mut self) -> JsResult<Option<(u32, Option<u32>)>> {
        let start = self.pos;
        self.pos += 1; // consume `{`
        let Some(min) = self.parse_bound()? else {
            self.pos = start;
            return Ok(None);
        };
        let max = if self.eat(',') {
            if self.peek() == Some('}') {
                None
            } else {
                match self.parse_bound()? {
                    Some(max) => Some(max),
                    None => {
                        self.pos = start;
                        return Ok(None);
                    }
                }
            }
        } else {
            Some(min)
        };
        if !self.eat('}') {
            self.pos = start;
            return Ok(None);
        }
        if let Some(max) = max {
            if min > max {
                return Err(syntax_error("numbers out of order in `{n,m}` quantifier"));
            }
        }
        Ok(Some((min, max)))
    }

    fn parse_bound(&mut self) -> JsResult<Option<u32>> {
        let mut digits = 0_usize;
        let mut value: u32 = 0;
        while let Some(digit) = self.peek().and_then(|next| next.to_digit(10)) {
            self.pos += 1;
            digits += 1;
            value = value.saturating_mul(10).saturating_add(digit);
            if value > MAX_QUANTIFIER_BOUND {
                return Err(syntax_error(format!(
                    "quantifier bound exceeds the supported limit of {MAX_QUANTIFIER_BOUND}"
                )));
            }
        }
        if digits == 0 {
            return Ok(None);
        }
        Ok(Some(value))
    }

    fn parse_escape_atom(&mut self) -> JsResult<Ast> {
        let Some(escaped) = self.bump() else {
            return Err(syntax_error("pattern ends with a trailing `\\`"));
        };
        let shorthand = |item: ClassItem| {
            Ast::Class(ClassSpec {
                negated: false,
                items: vec![item],
            })
        };
        match escaped {
            'd' => Ok(shorthand(ClassItem::Digit)),
            'D' => Ok(shorthand(ClassItem::NotDigit)),
            'w' => Ok(shorthand(ClassItem::Word)),
            'W' => Ok(shorthand(ClassItem::NotWord)),
            's' => Ok(shorthand(ClassItem::Space)),
            'S' => Ok(shorthand(ClassItem::NotSpace)),
            'b' | 'B' => Err(syntax_error(format!(
                "word-boundary assertion `\\{escaped}` is not supported"
            ))),
            'p' | 'P' => Err(syntax_error(format!(
                "unicode property escape `\\{escaped}` is not supported"
            ))),
            'k' => Err(syntax_error("named backreference `\\k` is not supported")),
            'c' => Err(syntax_error("control escape `\\c` is not supported")),
            '1'..='9' => Err(syntax_error(format!(
                "backreference `\\{escaped}` is not supported"
            ))),
            _ => self.finish_common_escape(escaped).map(Ast::Char),
        }
    }

    fn parse_class(&mut self) -> JsResult<ClassSpec> {
        let negated = self.eat('^');
        let mut items = Vec::new();
        loop {
            let Some(next) = self.peek() else {
                return Err(syntax_error("unterminated character class: missing `]`"));
            };
            if next == ']' {
                self.pos += 1;
                break;
            }
            let first = self.parse_class_member()?;
            let range = self.peek() == Some('-') && self.peek_at(1).is_some_and(|c| c != ']');
            if range {
                self.pos += 1; // consume `-`
                if self.peek().is_none() {
                    return Err(syntax_error("unterminated character class: missing `]`"));
                }
                let second = self.parse_class_member()?;
                match (first, second) {
                    (ClassMember::Char(low), ClassMember::Char(high)) => {
                        if low > high {
                            return Err(syntax_error("character class range out of order"));
                        }
                        items.push(ClassItem::Range(low, high));
                    }
                    _ => {
                        return Err(syntax_error(
                            "character class range bounded by a class escape is not supported",
                        ))
                    }
                }
            } else {
                items.push(match first {
                    ClassMember::Char(single) => ClassItem::Single(single),
                    ClassMember::Item(item) => item,
                });
            }
        }
        Ok(ClassSpec { negated, items })
    }

    fn parse_class_member(&mut self) -> JsResult<ClassMember> {
        let next = self.bump().expect("caller checked for input");
        if next != '\\' {
            return Ok(ClassMember::Char(next));
        }
        let Some(escaped) = self.bump() else {
            return Err(syntax_error("pattern ends with a trailing `\\`"));
        };
        match escaped {
            'd' => Ok(ClassMember::Item(ClassItem::Digit)),
            'D' => Ok(ClassMember::Item(ClassItem::NotDigit)),
            'w' => Ok(ClassMember::Item(ClassItem::Word)),
            'W' => Ok(ClassMember::Item(ClassItem::NotWord)),
            's' => Ok(ClassMember::Item(ClassItem::Space)),
            'S' => Ok(ClassMember::Item(ClassItem::NotSpace)),
            'b' => Ok(ClassMember::Char('\u{8}')),
            'p' | 'P' => Err(syntax_error(format!(
                "unicode property escape `\\{escaped}` is not supported"
            ))),
            'c' => Err(syntax_error("control escape `\\c` is not supported")),
            '1'..='9' => Err(syntax_error(format!(
                "octal escape `\\{escaped}` in character class is not supported"
            ))),
            _ => self.finish_common_escape(escaped).map(ClassMember::Char),
        }
    }

    /// Escapes valid both inside and outside character classes.
    fn finish_common_escape(&mut self, escaped: char) -> JsResult<char> {
        match escaped {
            'n' => Ok('\n'),
            'r' => Ok('\r'),
            't' => Ok('\t'),
            'f' => Ok('\u{c}'),
            'v' => Ok('\u{b}'),
            '0' => {
                if matches!(self.peek(), Some('0'..='9')) {
                    Err(syntax_error(
                        "legacy octal escape (`\\0` followed by a digit) is not supported",
                    ))
                } else {
                    Ok('\0')
                }
            }
            'x' => self.parse_hex_escape(2),
            'u' => {
                if self.peek() == Some('{') {
                    Err(syntax_error(
                        "`\\u{...}` escape requires the unsupported `u` flag",
                    ))
                } else {
                    self.parse_hex_escape(4)
                }
            }
            _ if !escaped.is_ascii_alphanumeric() => Ok(escaped),
            _ => Err(syntax_error(format!(
                "unrecognized escape `\\{escaped}` in RegExp pattern"
            ))),
        }
    }

    fn parse_hex_escape(&mut self, digits: usize) -> JsResult<char> {
        let mut value: u32 = 0;
        for _ in 0..digits {
            let Some(digit) = self.bump().and_then(|next| next.to_digit(16)) else {
                return Err(syntax_error("malformed hex escape in RegExp pattern"));
            };
            value = value * 16 + digit;
        }
        char::from_u32(value).ok_or_else(|| {
            syntax_error("hex escape resolving to a lone surrogate is not supported")
        })
    }
}
