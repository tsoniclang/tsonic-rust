#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UrlSearchParams {
    entries: Vec<(String, String)>,
}

impl UrlSearchParams {
    pub fn new(input: Option<&str>) -> NodeResult<Self> {
        let mut params = Self::default();
        if let Some(input) = input {
            let input = input.strip_prefix('?').unwrap_or(input);
            if !input.is_empty() {
                for part in input.split('&') {
                    let (key, value) = part.split_once('=').unwrap_or((part, ""));
                    params.append(&percent_decode(key), &percent_decode(value));
                }
            }
        }
        Ok(params)
    }

    pub fn get(&self, name: &str) -> Option<String> {
        self.entries
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    }

    pub fn get_all(&self, name: &str) -> Vec<String> {
        self.entries
            .iter()
            .filter(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn has(&self, name: &str) -> bool {
        self.entries.iter().any(|(key, _)| key == name)
    }

    pub fn has_value(&self, name: &str, value: &str) -> bool {
        self.entries
            .iter()
            .any(|(key, current)| key == name && current == value)
    }

    pub fn size(&self) -> usize {
        self.entries.len()
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.iter().map(|(key, _)| key.clone()).collect()
    }

    pub fn values(&self) -> Vec<String> {
        self.entries
            .iter()
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn entries(&self) -> Vec<(String, String)> {
        self.entries.clone()
    }

    pub fn sort(&mut self) {
        self.entries.sort_by(|left, right| left.0.cmp(&right.0));
    }

    pub fn for_each(&self, mut callback: impl FnMut(&str, &str)) {
        for (key, value) in &self.entries {
            callback(value, key);
        }
    }

    pub fn from_records(records: &BTreeMap<String, String>) -> Self {
        Self {
            entries: records
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        }
    }

    pub fn append(&mut self, name: &str, value: &str) {
        self.entries.push((name.to_string(), value.to_string()));
    }

    pub fn set(&mut self, name: &str, value: &str) {
        self.delete(name);
        self.append(name, value);
    }

    pub fn delete(&mut self, name: &str) {
        self.entries.retain(|(key, _)| key != name);
    }

    pub fn delete_value(&mut self, name: &str, value: &str) {
        self.entries
            .retain(|(key, current)| key != name || current != value);
    }
}

impl std::fmt::Display for UrlSearchParams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let body = self
            .entries
            .iter()
            .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        write!(f, "{body}")
    }
}
