//! Closed own-property object carrier.

use std::fmt;

use crate::value::JsValue;

pub type JsPropertyValue = JsValue;

#[derive(Debug, Clone, PartialEq)]
struct ObjectEntry {
    key: String,
    value: JsPropertyValue,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct JsObject {
    entries: Vec<ObjectEntry>,
}

impl JsObject {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_pairs<K, V>(pairs: impl IntoIterator<Item = (K, V)>) -> Self
    where
        K: Into<String>,
        V: Into<JsPropertyValue>,
    {
        let mut object = Self::new();
        for (key, value) in pairs {
            object.set(key, value);
        }
        object
    }

    pub fn get(&self, key: &str) -> JsValue {
        self.get_ref(key).cloned().unwrap_or(JsValue::Undefined)
    }

    pub fn get_ref(&self, key: &str) -> Option<&JsValue> {
        self.entries
            .iter()
            .find(|entry| entry.key == key)
            .map(|entry| &entry.value)
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<JsPropertyValue>) {
        let key = key.into();
        let value = value.into();
        match self.entries.iter_mut().find(|entry| entry.key == key) {
            Some(entry) => entry.value = value,
            None => self.entries.push(ObjectEntry { key, value }),
        }
    }

    pub fn delete(&mut self, key: &str) -> bool {
        if let Some(index) = self.entries.iter().position(|entry| entry.key == key) {
            self.entries.remove(index);
            true
        } else {
            false
        }
    }

    pub fn has_own_property(&self, key: &str) -> bool {
        self.entries.iter().any(|entry| entry.key == key)
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.iter().map(|entry| entry.key.clone()).collect()
    }

    pub fn values(&self) -> Vec<JsPropertyValue> {
        self.entries
            .iter()
            .map(|entry| entry.value.clone())
            .collect()
    }

    pub fn entries(&self) -> Vec<(String, JsPropertyValue)> {
        self.entries
            .iter()
            .map(|entry| (entry.key.clone(), entry.value.clone()))
            .collect()
    }

    pub fn assign(&mut self, sources: &[JsObject]) {
        for source in sources {
            for entry in &source.entries {
                self.set(entry.key.clone(), entry.value.clone());
            }
        }
    }

    pub fn inspect(&self) -> String {
        let body = self
            .entries
            .iter()
            .map(|entry| format!("{}: {}", entry.key, entry.value.inspect()))
            .collect::<Vec<_>>()
            .join(", ");
        format!("{{{body}}}")
    }
}

impl fmt::Display for JsObject {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.inspect())
    }
}
