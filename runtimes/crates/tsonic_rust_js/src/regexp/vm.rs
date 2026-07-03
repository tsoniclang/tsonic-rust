//! Backtracking bytecode compiler and interpreter for the RegExp subset.
//!
//! The interpreter is an explicit-stack backtracker: greedy quantifiers try
//! the longer alternative first and captures are unwound through an undo log,
//! matching the priority order of the ECMAScript pattern-matching semantics.
//! Iterations of unbounded or optional repeats that match the empty string
//! fail, per the `RepeatMatcher` empty-check, and capture slots inside a
//! repeat body are cleared at the start of every iteration.

use super::parser::{Ast, ClassItem, ClassSpec, ParsedPattern};

#[derive(Debug, Clone)]
enum Inst {
    Char(char),
    Dot,
    Class(ClassSpec),
    /// Try `first`; on failure resume at `second`.
    Split {
        first: usize,
        second: usize,
    },
    Jmp(usize),
    Save(usize),
    /// Clear capture slots in `lo..=hi` (start of a repeat iteration).
    ClearCaps {
        lo: usize,
        hi: usize,
    },
    /// Record the current position for the empty-iteration check.
    SetLoop(usize),
    /// Fail if the iteration matched the empty string; otherwise continue at
    /// `back` (or fall through when `back` is `None`).
    Loop {
        slot: usize,
        back: Option<usize>,
    },
    AssertStart,
    AssertEnd,
    Match,
}

#[derive(Debug, Clone)]
pub(crate) struct Program {
    insts: Vec<Inst>,
    pub(crate) group_count: usize,
    loop_count: usize,
}

pub(crate) fn compile(parsed: &ParsedPattern) -> Program {
    let mut compiler = Compiler {
        insts: Vec::new(),
        loop_count: 0,
    };
    compiler.insts.push(Inst::Save(0));
    compiler.emit(&parsed.ast);
    compiler.insts.push(Inst::Save(1));
    compiler.insts.push(Inst::Match);
    Program {
        insts: compiler.insts,
        group_count: parsed.group_count as usize,
        loop_count: compiler.loop_count,
    }
}

struct Compiler {
    insts: Vec<Inst>,
    loop_count: usize,
}

impl Compiler {
    fn emit(&mut self, ast: &Ast) {
        match ast {
            Ast::Char(value) => self.insts.push(Inst::Char(*value)),
            Ast::Dot => self.insts.push(Inst::Dot),
            Ast::Class(spec) => self.insts.push(Inst::Class(spec.clone())),
            Ast::AnchorStart => self.insts.push(Inst::AssertStart),
            Ast::AnchorEnd => self.insts.push(Inst::AssertEnd),
            Ast::Concat(items) => {
                for item in items {
                    self.emit(item);
                }
            }
            Ast::Alternation(branches) => self.emit_alternation(branches),
            Ast::Group { index, body } => {
                if let Some(index) = index {
                    self.insts.push(Inst::Save(2 * *index as usize));
                }
                self.emit(body);
                if let Some(index) = index {
                    self.insts.push(Inst::Save(2 * *index as usize + 1));
                }
            }
            Ast::Repeat { body, min, max } => self.emit_repeat(body, *min, *max),
        }
    }

    fn emit_alternation(&mut self, branches: &[Ast]) {
        let mut end_jumps = Vec::new();
        for (index, branch) in branches.iter().enumerate() {
            let is_last = index + 1 == branches.len();
            let split_at = (!is_last).then(|| {
                let at = self.insts.len();
                self.insts.push(Inst::Split {
                    first: at + 1,
                    second: usize::MAX,
                });
                at
            });
            self.emit(branch);
            if !is_last {
                end_jumps.push(self.insts.len());
                self.insts.push(Inst::Jmp(usize::MAX));
            }
            if let Some(at) = split_at {
                let next = self.insts.len();
                if let Inst::Split { second, .. } = &mut self.insts[at] {
                    *second = next;
                }
            }
        }
        let end = self.insts.len();
        for at in end_jumps {
            if let Inst::Jmp(target) = &mut self.insts[at] {
                *target = end;
            }
        }
    }

    fn emit_repeat(&mut self, body: &Ast, min: u32, max: Option<u32>) {
        let clear = capture_slot_range(body);
        for _ in 0..min {
            self.emit_iteration_prologue(clear, None);
            self.emit(body);
        }
        match max {
            None => {
                let slot = self.next_loop_slot();
                let start = self.insts.len();
                self.insts.push(Inst::Split {
                    first: start + 1,
                    second: usize::MAX,
                });
                self.emit_iteration_prologue(clear, Some(slot));
                self.emit(body);
                self.insts.push(Inst::Loop {
                    slot,
                    back: Some(start),
                });
                let end = self.insts.len();
                if let Inst::Split { second, .. } = &mut self.insts[start] {
                    *second = end;
                }
            }
            Some(max) => {
                let optional = max - min;
                if optional == 0 {
                    return;
                }
                let slot = self.next_loop_slot();
                let mut split_ats = Vec::new();
                for _ in 0..optional {
                    let at = self.insts.len();
                    self.insts.push(Inst::Split {
                        first: at + 1,
                        second: usize::MAX,
                    });
                    split_ats.push(at);
                    self.emit_iteration_prologue(clear, Some(slot));
                    self.emit(body);
                    self.insts.push(Inst::Loop { slot, back: None });
                }
                let end = self.insts.len();
                for at in split_ats {
                    if let Inst::Split { second, .. } = &mut self.insts[at] {
                        *second = end;
                    }
                }
            }
        }
    }

    fn emit_iteration_prologue(&mut self, clear: Option<(usize, usize)>, loop_slot: Option<usize>) {
        if let Some(slot) = loop_slot {
            self.insts.push(Inst::SetLoop(slot));
        }
        if let Some((lo, hi)) = clear {
            self.insts.push(Inst::ClearCaps { lo, hi });
        }
    }

    fn next_loop_slot(&mut self) -> usize {
        let slot = self.loop_count;
        self.loop_count += 1;
        slot
    }
}

/// Returns the inclusive capture-slot range used by groups inside `ast`.
fn capture_slot_range(ast: &Ast) -> Option<(usize, usize)> {
    fn walk(ast: &Ast, lo: &mut Option<u32>, hi: &mut Option<u32>) {
        match ast {
            Ast::Group { index, body } => {
                if let Some(index) = index {
                    *lo = Some(lo.map_or(*index, |current| current.min(*index)));
                    *hi = Some(hi.map_or(*index, |current| current.max(*index)));
                }
                walk(body, lo, hi);
            }
            Ast::Alternation(items) | Ast::Concat(items) => {
                for item in items {
                    walk(item, lo, hi);
                }
            }
            Ast::Repeat { body, .. } => walk(body, lo, hi),
            _ => {}
        }
    }
    let (mut lo, mut hi) = (None, None);
    walk(ast, &mut lo, &mut hi);
    Some((2 * lo? as usize, 2 * hi? as usize + 1))
}

enum Undo {
    Cap { slot: usize, value: Option<usize> },
    Loop { slot: usize, value: usize },
}

struct Frame {
    pc: usize,
    pos: usize,
    undo_len: usize,
}

/// Runs the program anchored at char index `start`. On success returns the
/// capture slots (`2k` = group-k start, `2k + 1` = group-k end, group 0 being
/// the whole match), as char indexes into `chars`.
pub(crate) fn exec_at(
    program: &Program,
    chars: &[char],
    start: usize,
    ignore_case: bool,
    multiline: bool,
) -> Option<Vec<Option<usize>>> {
    let mut caps: Vec<Option<usize>> = vec![None; 2 * (program.group_count + 1)];
    let mut loops: Vec<usize> = vec![0; program.loop_count];
    let mut undo: Vec<Undo> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut pc = 0_usize;
    let mut pos = start;

    loop {
        let mut failed = false;
        match &program.insts[pc] {
            Inst::Char(expected) => {
                if pos < chars.len() && chars_equal(chars[pos], *expected, ignore_case) {
                    pos += 1;
                    pc += 1;
                } else {
                    failed = true;
                }
            }
            Inst::Dot => {
                if pos < chars.len() && !is_line_terminator(chars[pos]) {
                    pos += 1;
                    pc += 1;
                } else {
                    failed = true;
                }
            }
            Inst::Class(spec) => {
                if pos < chars.len() && class_matches(spec, chars[pos], ignore_case) {
                    pos += 1;
                    pc += 1;
                } else {
                    failed = true;
                }
            }
            Inst::Split { first, second } => {
                stack.push(Frame {
                    pc: *second,
                    pos,
                    undo_len: undo.len(),
                });
                pc = *first;
            }
            Inst::Jmp(target) => pc = *target,
            Inst::Save(slot) => {
                undo.push(Undo::Cap {
                    slot: *slot,
                    value: caps[*slot],
                });
                caps[*slot] = Some(pos);
                pc += 1;
            }
            Inst::ClearCaps { lo, hi } => {
                for (offset, value) in caps[*lo..=*hi].iter_mut().enumerate() {
                    undo.push(Undo::Cap {
                        slot: lo + offset,
                        value: *value,
                    });
                    *value = None;
                }
                pc += 1;
            }
            Inst::SetLoop(slot) => {
                undo.push(Undo::Loop {
                    slot: *slot,
                    value: loops[*slot],
                });
                loops[*slot] = pos;
                pc += 1;
            }
            Inst::Loop { slot, back } => {
                if pos == loops[*slot] {
                    failed = true;
                } else {
                    pc = back.unwrap_or(pc + 1);
                }
            }
            Inst::AssertStart => {
                if pos == 0 || (multiline && is_line_terminator(chars[pos - 1])) {
                    pc += 1;
                } else {
                    failed = true;
                }
            }
            Inst::AssertEnd => {
                if pos == chars.len() || (multiline && is_line_terminator(chars[pos])) {
                    pc += 1;
                } else {
                    failed = true;
                }
            }
            Inst::Match => return Some(caps),
        }
        if failed {
            let frame = stack.pop()?;
            while undo.len() > frame.undo_len {
                match undo.pop().expect("undo entry") {
                    Undo::Cap { slot, value } => caps[slot] = value,
                    Undo::Loop { slot, value } => loops[slot] = value,
                }
            }
            pc = frame.pc;
            pos = frame.pos;
        }
    }
}

pub(crate) fn is_line_terminator(value: char) -> bool {
    matches!(value, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// First-char simple lowercase mapping; falls back to the char itself when
/// the full mapping expands to more than one char (mirrors the single-char
/// canonicalization rule of non-unicode-mode `RegExp`).
fn simple_lowercase(value: char) -> char {
    let mut mapped = value.to_lowercase();
    match (mapped.next(), mapped.next()) {
        (Some(single), None) => single,
        _ => value,
    }
}

fn simple_uppercase(value: char) -> char {
    let mut mapped = value.to_uppercase();
    match (mapped.next(), mapped.next()) {
        (Some(single), None) => single,
        _ => value,
    }
}

fn chars_equal(actual: char, expected: char, ignore_case: bool) -> bool {
    if actual == expected {
        return true;
    }
    ignore_case
        && (simple_lowercase(actual) == simple_lowercase(expected)
            || simple_uppercase(actual) == simple_uppercase(expected))
}

fn class_matches(spec: &ClassSpec, actual: char, ignore_case: bool) -> bool {
    let mut candidates = vec![actual];
    if ignore_case {
        for folded in [simple_lowercase(actual), simple_uppercase(actual)] {
            if !candidates.contains(&folded) {
                candidates.push(folded);
            }
        }
    }
    let member = spec
        .items
        .iter()
        .any(|item| candidates.iter().any(|value| item_matches(item, *value)));
    member != spec.negated
}

fn item_matches(item: &ClassItem, value: char) -> bool {
    match item {
        ClassItem::Single(single) => value == *single,
        ClassItem::Range(low, high) => (*low..=*high).contains(&value),
        ClassItem::Digit => value.is_ascii_digit(),
        ClassItem::NotDigit => !value.is_ascii_digit(),
        ClassItem::Word => is_word_char(value),
        ClassItem::NotWord => !is_word_char(value),
        ClassItem::Space => is_js_whitespace(value),
        ClassItem::NotSpace => !is_js_whitespace(value),
    }
}

fn is_word_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '_'
}

fn is_js_whitespace(value: char) -> bool {
    matches!(
        value,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}
