use std::collections::VecDeque;

#[derive(Debug, Clone, Default)]
pub struct Interface {
    input: VecDeque<String>,
    output: Vec<String>,
    closed: bool,
    paused: bool,
    prompt: String,
    line: String,
    cursor: usize,
    terminal: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CursorPos {
    pub rows: usize,
    pub cols: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Key {
    pub sequence: Option<String>,
    pub name: Option<String>,
    pub ctrl: bool,
    pub meta: bool,
    pub shift: bool,
}

impl Interface {
    pub fn new(lines: impl IntoIterator<Item = String>) -> Self {
        Self {
            input: lines.into_iter().collect(),
            output: Vec::new(),
            closed: false,
            paused: false,
            prompt: "> ".to_string(),
            line: String::new(),
            cursor: 0,
            terminal: false,
        }
    }

    pub fn question(&mut self, query: &str) -> Option<String> {
        if self.closed || self.paused {
            return None;
        }
        self.output.push(query.to_string());
        self.input.pop_front()
    }

    pub fn write(&mut self, text: &str) {
        if !self.closed && !self.paused {
            self.output.push(text.to_string());
            self.line.push_str(text);
            self.cursor = self.line.len();
        }
    }

    pub fn write_key(&mut self, text: Option<&str>, key: Option<Key>) {
        if let Some(text) = text {
            self.write(text);
        } else if let Some(key) = key {
            if let Some(sequence) = key.sequence {
                self.write(&sequence);
            }
        }
    }

    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self) {
        self.paused = false;
    }

    pub fn paused(&self) -> bool {
        self.paused
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn output(&self) -> &[String] {
        &self.output
    }

    pub fn set_prompt(&mut self, prompt: &str) {
        self.prompt = prompt.to_string();
    }

    pub fn get_prompt(&self) -> &str {
        &self.prompt
    }

    pub fn prompt(&mut self, _preserve_cursor: bool) {
        if !self.closed && !self.paused {
            self.output.push(self.prompt.clone());
        }
    }

    pub fn line(&self) -> &str {
        &self.line
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn get_cursor_pos(&self) -> CursorPos {
        CursorPos {
            rows: 0,
            cols: self.cursor,
        }
    }

    pub fn terminal(&self) -> bool {
        self.terminal
    }

    pub fn set_terminal(&mut self, terminal: bool) {
        self.terminal = terminal;
    }

    pub fn next_line(&mut self) -> Option<String> {
        if self.closed || self.paused {
            None
        } else {
            self.input.pop_front()
        }
    }

    pub fn remaining_lines(&self) -> Vec<String> {
        self.input.iter().cloned().collect()
    }
}

pub fn create_interface(lines: impl IntoIterator<Item = String>) -> Interface {
    Interface::new(lines)
}

#[derive(Debug, Clone, Default)]
pub struct Readline {
    stream: Vec<String>,
    auto_commit: bool,
    options: ReadlineOptions,
    pending: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReadlineOptions {
    pub input: Option<String>,
    pub output: Option<String>,
    pub terminal: bool,
    pub completer: Option<String>,
    pub auto_commit: bool,
}

impl Readline {
    pub fn new(auto_commit: bool) -> Self {
        Self::with_options(ReadlineOptions {
            auto_commit,
            ..Default::default()
        })
    }

    pub fn with_options(options: ReadlineOptions) -> Self {
        Self {
            stream: Vec::new(),
            auto_commit: options.auto_commit,
            options,
            pending: Vec::new(),
        }
    }

    pub fn clear_line(&mut self, direction: i32) -> &mut Self {
        self.enqueue(format!("clearLine:{direction}"));
        self
    }

    pub fn clear_screen_down(&mut self) -> &mut Self {
        self.enqueue("clearScreenDown".to_string());
        self
    }

    pub fn cursor_to(&mut self, x: usize, y: Option<usize>) -> &mut Self {
        self.enqueue(format!("cursorTo:{x}:{}", y.unwrap_or(0)));
        self
    }

    pub fn move_cursor(&mut self, dx: isize, dy: isize) -> &mut Self {
        self.enqueue(format!("moveCursor:{dx}:{dy}"));
        self
    }

    pub fn commit(&mut self) {
        self.stream.append(&mut self.pending);
    }

    pub fn rollback(&mut self) -> &mut Self {
        self.pending.clear();
        self
    }

    pub fn stream(&self) -> &[String] {
        &self.stream
    }

    pub fn pending(&self) -> &[String] {
        &self.pending
    }

    pub fn auto_commit(&self) -> bool {
        self.auto_commit
    }

    pub fn options(&self) -> &ReadlineOptions {
        &self.options
    }

    fn enqueue(&mut self, value: String) {
        if self.auto_commit {
            self.stream.push(value);
        } else {
            self.pending.push(value);
        }
    }
}

pub mod promises {
    pub use super::{create_interface, CursorPos, Interface, Key, Readline};

    pub fn create_readline(auto_commit: bool) -> Readline {
        Readline::new(auto_commit)
    }
}
