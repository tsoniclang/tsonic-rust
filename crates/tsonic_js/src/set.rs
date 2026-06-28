//! Closed Set carrier with insertion-order semantics and SameValueZero equality.

use crate::equality::JsSameValueZero;

#[derive(Debug, Clone, PartialEq)]
pub struct JsSet<T> {
    values: Vec<T>,
}

impl<T> JsSet<T> {
    pub fn new() -> Self {
        Self { values: Vec::new() }
    }

    pub fn from_values(values: impl IntoIterator<Item = T>) -> Self
    where
        T: JsSameValueZero,
    {
        let mut set = Self::new();
        for value in values {
            set.add(value);
        }
        set
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    pub fn clear(&mut self) {
        self.values.clear();
    }

    pub fn has(&self, value: &T) -> bool
    where
        T: JsSameValueZero,
    {
        self.values
            .iter()
            .any(|existing| existing.same_value_zero(value))
    }

    pub fn add(&mut self, value: T)
    where
        T: JsSameValueZero,
    {
        if !self.has(&value) {
            self.values.push(value);
        }
    }

    pub fn delete(&mut self, value: &T) -> bool
    where
        T: JsSameValueZero,
    {
        if let Some(index) = self
            .values
            .iter()
            .position(|item| item.same_value_zero(value))
        {
            self.values.remove(index);
            return true;
        }
        false
    }

    pub fn keys(&self) -> Vec<&T> {
        self.values.iter().collect()
    }

    pub fn values(&self) -> Vec<&T> {
        self.values.iter().collect()
    }

    pub fn entries(&self) -> Vec<(&T, &T)> {
        self.values.iter().map(|value| (value, value)).collect()
    }

    pub fn for_each<F>(&self, mut callback: F)
    where
        F: FnMut(&T, &T, &Self),
    {
        for value in &self.values {
            callback(value, value, self);
        }
    }
}

impl<T> Default for JsSet<T> {
    fn default() -> Self {
        Self::new()
    }
}
