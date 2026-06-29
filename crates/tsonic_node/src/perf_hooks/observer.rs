#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceObserverEntryList {
    entries: Vec<PerformanceEntry>,
}

impl PerformanceObserverEntryList {
    pub fn new(entries: Vec<PerformanceEntry>) -> Self {
        Self { entries }
    }

    pub fn get_entries(&self) -> Vec<PerformanceEntry> {
        self.entries.clone()
    }

    pub fn get_entries_by_name(
        &self,
        name: &str,
        entry_type: Option<&str>,
    ) -> Vec<PerformanceEntry> {
        self.entries
            .iter()
            .filter(|entry| entry.name == name)
            .filter(|entry| entry_type.is_none_or(|entry_type| entry.entry_type == entry_type))
            .cloned()
            .collect()
    }

    pub fn get_entries_by_type(&self, entry_type: &str) -> Vec<PerformanceEntry> {
        self.entries
            .iter()
            .filter(|entry| entry.entry_type == entry_type)
            .cloned()
            .collect()
    }
}

pub struct PerformanceObserver {
    callback: Box<dyn FnMut(PerformanceObserverEntryList) + Send>,
    observed_types: Vec<String>,
    records: Vec<PerformanceEntry>,
    connected: bool,
}

impl PerformanceObserver {
    pub fn new(callback: impl FnMut(PerformanceObserverEntryList) + Send + 'static) -> Self {
        Self {
            callback: Box::new(callback),
            observed_types: Vec::new(),
            records: Vec::new(),
            connected: true,
        }
    }

    pub fn supported_entry_types() -> &'static [&'static str] {
        &["mark", "measure"]
    }

    pub fn observe(&mut self, entry_types: &[&str], buffered: bool) {
        self.observed_types = entry_types
            .iter()
            .map(|entry_type| entry_type.to_string())
            .collect();
        self.connected = true;
        if buffered {
            self.records = get_entries()
                .into_iter()
                .filter(|entry| {
                    self.observed_types
                        .iter()
                        .any(|entry_type| entry_type == &entry.entry_type)
                })
                .collect();
            (self.callback)(PerformanceObserverEntryList::new(self.records.clone()));
        }
    }

    pub fn take_records(&mut self) -> Vec<PerformanceEntry> {
        std::mem::take(&mut self.records)
    }

    pub fn disconnect(&mut self) {
        self.connected = false;
        self.observed_types.clear();
    }

    pub fn connected(&self) -> bool {
        self.connected
    }
}
