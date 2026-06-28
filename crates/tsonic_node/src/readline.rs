use std::collections::VecDeque;

#[derive(Debug, Clone, Default)]
pub struct Interface {
    input: VecDeque<String>,
    output: Vec<String>,
    closed: bool,
    paused: bool,
}

impl Interface {
    pub fn new(lines: impl IntoIterator<Item = String>) -> Self {
        Self {
            input: lines.into_iter().collect(),
            output: Vec::new(),
            closed: false,
            paused: false,
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
