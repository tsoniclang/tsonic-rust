#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Headers {
    entries: BTreeMap<String, Vec<String>>,
}

impl Headers {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_pairs<K, V>(pairs: impl IntoIterator<Item = (K, V)>) -> Self
    where
        K: Into<String>,
        V: Into<String>,
    {
        let mut headers = Self::new();
        for (key, value) in pairs {
            headers.append(key, value);
        }
        headers
    }

    pub fn append(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.entries
            .entry(normalize_header_name(key.into()))
            .or_default()
            .push(value.into());
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.entries
            .insert(normalize_header_name(key.into()), vec![value.into()]);
    }

    pub fn get(&self, key: impl AsRef<str>) -> Option<String> {
        self.entries
            .get(&normalize_header_name(key.as_ref()))
            .map(|values| values.join(", "))
    }

    pub fn get_all(&self, key: impl AsRef<str>) -> Vec<String> {
        self.entries
            .get(&normalize_header_name(key.as_ref()))
            .cloned()
            .unwrap_or_default()
    }

    pub fn has(&self, key: impl AsRef<str>) -> bool {
        self.entries
            .contains_key(&normalize_header_name(key.as_ref()))
    }

    pub fn delete(&mut self, key: impl AsRef<str>) {
        self.entries.remove(&normalize_header_name(key.as_ref()));
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }

    pub fn values(&self) -> Vec<String> {
        self.entries
            .values()
            .map(|values| values.join(", "))
            .collect()
    }

    pub fn entries(&self) -> Vec<(String, String)> {
        self.entries
            .iter()
            .map(|(key, values)| (key.clone(), values.join(", ")))
            .collect()
    }

    pub fn for_each(&self, mut callback: impl FnMut(&str, &str)) {
        for (key, value) in self.entries() {
            callback(&value, &key);
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FormData {
    entries: Vec<(String, FormDataValue)>,
}

impl FormData {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&mut self, key: impl Into<String>, value: FormDataValue) {
        self.entries.push((key.into(), value));
    }

    pub fn set(&mut self, key: impl Into<String>, value: FormDataValue) {
        let key = key.into();
        self.delete(&key);
        self.entries.push((key, value));
    }

    pub fn get(&self, key: &str) -> Option<FormDataValue> {
        self.entries
            .iter()
            .find(|(entry_key, _)| entry_key == key)
            .map(|(_, value)| value.clone())
    }

    pub fn get_all(&self, key: &str) -> Vec<FormDataValue> {
        self.entries
            .iter()
            .filter(|(entry_key, _)| entry_key == key)
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn has(&self, key: &str) -> bool {
        self.entries.iter().any(|(entry_key, _)| entry_key == key)
    }

    pub fn delete(&mut self, key: &str) {
        self.entries.retain(|(entry_key, _)| entry_key != key);
    }

    pub fn entries(&self) -> Vec<(String, FormDataValue)> {
        self.entries.clone()
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.iter().map(|(key, _)| key.clone()).collect()
    }

    pub fn values(&self) -> Vec<FormDataValue> {
        self.entries
            .iter()
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn for_each(&self, mut callback: impl FnMut(&FormDataValue, &str)) {
        for (key, value) in &self.entries {
            callback(value, key);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormDataValue {
    String(String),
    File(File),
}
