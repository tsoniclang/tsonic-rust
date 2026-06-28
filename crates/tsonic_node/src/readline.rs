use std::collections::VecDeque;

#[derive(Debug, Clone, Default)]
pub struct Interface {
    input: VecDeque<String>,
    output: Vec<String>,
    closed: bool,
}

impl Interface {
    pub fn new(lines: impl IntoIterator<Item = String>) -> Self {
        Self {
            input: lines.into_iter().collect(),
            output: Vec::new(),
            closed: false,
        }
    }

    pub fn question(&mut self, query: &str) -> Option<String> {
        if self.closed {
            return None;
        }
        self.output.push(query.to_string());
        self.input.pop_front()
    }

    pub fn write(&mut self, text: &str) {
        if !self.closed {
            self.output.push(text.to_string());
        }
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
}

pub fn create_interface(lines: impl IntoIterator<Item = String>) -> Interface {
    Interface::new(lines)
}
