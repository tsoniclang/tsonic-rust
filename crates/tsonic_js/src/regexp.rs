//! Explicit RegExp subset without an embedded JS engine.

use crate::errors::{syntax_error, unsupported, JsResult};

#[derive(Debug, Clone)]
pub struct JsRegExp {
    pattern: Pattern,
    flags: String,
    global: bool,
    sticky: bool,
    ignore_case: bool,
    last_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsRegExpMatch {
    pub match_text: String,
    pub index: usize,
    pub groups: Vec<String>,
}

#[derive(Debug, Clone)]
enum Pattern {
    Literal(String),
    AnyOne,
    AnyMany,
    LowerAsciiCapturePlus,
    Empty,
}

impl JsRegExp {
    pub fn new(pattern: &str, flags: &str) -> JsResult<Self> {
        validate_flags(flags)?;
        Ok(Self {
            pattern: parse_pattern(pattern)?,
            flags: flags.to_string(),
            global: flags.contains('g'),
            sticky: flags.contains('y'),
            ignore_case: flags.contains('i'),
            last_index: 0,
        })
    }

    pub fn flags(&self) -> &str {
        &self.flags
    }

    pub fn last_index(&self) -> usize {
        self.last_index
    }

    pub fn set_last_index(&mut self, index: usize) {
        self.last_index = index;
    }

    pub fn test(&mut self, value: &str) -> bool {
        self.exec(value).is_some()
    }

    pub fn exec(&mut self, value: &str) -> Option<JsRegExpMatch> {
        let start = if self.global || self.sticky {
            self.last_index.min(value.len())
        } else {
            0
        };
        let found = find_pattern(&self.pattern, value, start, self.sticky, self.ignore_case);
        if self.global || self.sticky {
            self.last_index = found
                .as_ref()
                .map(|found| found.index + found.match_text.len())
                .unwrap_or(0);
        }
        found
    }
}

fn validate_flags(flags: &str) -> JsResult<()> {
    let mut seen = Vec::new();
    for flag in flags.chars() {
        if !matches!(flag, 'g' | 'i' | 'm' | 's' | 'u' | 'y') {
            return Err(syntax_error(format!("unsupported RegExp flag `{flag}`")));
        }
        if seen.contains(&flag) {
            return Err(syntax_error(format!("duplicate RegExp flag `{flag}`")));
        }
        seen.push(flag);
    }
    Ok(())
}

fn parse_pattern(pattern: &str) -> JsResult<Pattern> {
    match pattern {
        "" => Ok(Pattern::Empty),
        "." => Ok(Pattern::AnyOne),
        ".*" | ".+" => Ok(Pattern::AnyMany),
        "([a-z]+)" => Ok(Pattern::LowerAsciiCapturePlus),
        _ if pattern.contains('\\')
            || pattern.contains('[')
            || pattern.contains('(')
            || pattern.contains('|')
            || pattern.contains('*')
            || pattern.contains('+')
            || pattern.contains('?') =>
        {
            Err(unsupported("RegExp feature is outside the Stage 1 subset"))
        }
        _ => Ok(Pattern::Literal(pattern.to_string())),
    }
}

fn find_pattern(
    pattern: &Pattern,
    value: &str,
    start: usize,
    sticky: bool,
    ignore_case: bool,
) -> Option<JsRegExpMatch> {
    let haystack = value.get(start..)?;
    match pattern {
        Pattern::Empty => Some(JsRegExpMatch {
            match_text: String::new(),
            index: start,
            groups: Vec::new(),
        }),
        Pattern::Literal(needle) => {
            let relative = if ignore_case {
                haystack.to_lowercase().find(&needle.to_lowercase())
            } else {
                haystack.find(needle)
            }?;
            if sticky && relative != 0 {
                return None;
            }
            Some(JsRegExpMatch {
                match_text: haystack[relative..relative + needle.len()].to_string(),
                index: start + relative,
                groups: Vec::new(),
            })
        }
        Pattern::AnyOne => {
            let ch = haystack.chars().next()?;
            Some(JsRegExpMatch {
                match_text: ch.to_string(),
                index: start,
                groups: Vec::new(),
            })
        }
        Pattern::AnyMany => Some(JsRegExpMatch {
            match_text: haystack.to_string(),
            index: start,
            groups: Vec::new(),
        }),
        Pattern::LowerAsciiCapturePlus => {
            for (offset, _) in haystack.char_indices() {
                if sticky && offset != 0 {
                    return None;
                }
                let suffix = &haystack[offset..];
                let run = suffix
                    .chars()
                    .take_while(|ch| ch.is_ascii_lowercase())
                    .collect::<String>();
                if !run.is_empty() {
                    return Some(JsRegExpMatch {
                        match_text: run.clone(),
                        index: start + offset,
                        groups: vec![run],
                    });
                }
                if sticky {
                    return None;
                }
            }
            None
        }
    }
}
