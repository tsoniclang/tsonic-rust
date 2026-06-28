#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BooleanObject(pub bool);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StringObject(pub String);

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NumberObject(pub f64);

impl BooleanObject {
    pub fn value_of(&self) -> bool {
        self.0
    }
}

impl StringObject {
    pub fn value_of(&self) -> &str {
        &self.0
    }
}

impl NumberObject {
    pub fn value_of(&self) -> f64 {
        self.0
    }
}
