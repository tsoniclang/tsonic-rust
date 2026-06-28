//! Closed Map carrier with insertion-order semantics and configurable equality hooks.

use crate::equality::JsSameValueZero;

#[derive(Debug, Clone, PartialEq)]
pub struct JsMap<K, V> {
    entries: Vec<(K, V)>,
}

impl<K, V> JsMap<K, V> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn from_entries(entries: impl IntoIterator<Item = (K, V)>) -> Self
    where
        K: JsSameValueZero + Clone,
        V: Clone,
    {
        let mut map = Self::new();
        for (key, value) in entries {
            map.set(key, value);
        }
        map
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn get(&self, key: &K) -> Option<&V>
    where
        K: JsSameValueZero,
    {
        self.entries.iter().find_map(|(existing_key, value)| {
            if existing_key.same_value_zero(key) {
                Some(value)
            } else {
                None
            }
        })
    }

    pub fn set(&mut self, key: K, value: V)
    where
        K: JsSameValueZero + Clone,
        V: Clone,
    {
        let mut index = None;
        for (i, (existing_key, _)) in self.entries.iter().enumerate() {
            if existing_key.same_value_zero(&key) {
                index = Some(i);
                break;
            }
        }
        if let Some(i) = index {
            self.entries[i] = (key, value);
        } else {
            self.entries.push((key, value));
        }
    }

    pub fn has(&self, key: &K) -> bool
    where
        K: JsSameValueZero,
    {
        self.get(key).is_some()
    }

    pub fn delete(&mut self, key: &K) -> bool
    where
        K: JsSameValueZero,
    {
        if let Some(index) = self
            .entries
            .iter()
            .position(|(existing_key, _)| existing_key.same_value_zero(key))
        {
            self.entries.remove(index);
            return true;
        }
        false
    }

    pub fn keys(&self) -> Vec<&K> {
        self.entries.iter().map(|(key, _)| key).collect()
    }

    pub fn values(&self) -> Vec<&V> {
        self.entries.iter().map(|(_, value)| value).collect()
    }

    pub fn entries(&self) -> Vec<(&K, &V)> {
        self.entries
            .iter()
            .map(|(key, value)| (key, value))
            .collect()
    }

    pub fn for_each<F>(&self, mut callback: F)
    where
        F: FnMut(&V, &K, &Self),
    {
        for (key, value) in &self.entries {
            callback(value, key, self);
        }
    }

    pub fn into_entries(self) -> Vec<(K, V)> {
        self.entries
    }
}

impl<K, V> Default for JsMap<K, V> {
    fn default() -> Self {
        Self::new()
    }
}
