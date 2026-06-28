use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();
static MARKS: OnceLock<Mutex<Vec<PerformanceMark>>> = OnceLock::new();
static MEASURES: OnceLock<Mutex<Vec<PerformanceMeasure>>> = OnceLock::new();

pub fn performance_now() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

pub fn time_origin() -> f64 {
    0.0
}

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceMark {
    pub name: String,
    pub start_time: f64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceMeasure {
    pub name: String,
    pub start_time: f64,
    pub duration: f64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceEntry {
    pub name: String,
    pub entry_type: String,
    pub start_time: f64,
    pub duration: f64,
}

pub fn mark(name: &str) -> PerformanceMark {
    mark_with_detail(name, None)
}

pub fn mark_with_detail(name: &str, detail: Option<String>) -> PerformanceMark {
    let mark = PerformanceMark {
        name: name.to_string(),
        start_time: performance_now(),
        detail,
    };
    marks().lock().unwrap().push(mark.clone());
    mark
}

pub fn measure(name: &str, start_mark: Option<&str>, end_mark: Option<&str>) -> PerformanceMeasure {
    let start_time = start_mark
        .and_then(find_mark)
        .map(|mark| mark.start_time)
        .unwrap_or(0.0);
    let end_time = end_mark
        .and_then(find_mark)
        .map(|mark| mark.start_time)
        .unwrap_or_else(performance_now);
    let measure = PerformanceMeasure {
        name: name.to_string(),
        start_time,
        duration: (end_time - start_time).max(0.0),
        detail: None,
    };
    measures().lock().unwrap().push(measure.clone());
    measure
}

pub fn get_entries() -> Vec<PerformanceEntry> {
    let marks = marks().lock().unwrap();
    let mut entries = marks
        .iter()
        .map(|mark| PerformanceEntry {
            name: mark.name.clone(),
            entry_type: "mark".to_string(),
            start_time: mark.start_time,
            duration: 0.0,
        })
        .collect::<Vec<_>>();
    drop(marks);
    let measures = measures().lock().unwrap();
    entries.extend(measures.iter().map(|measure| PerformanceEntry {
        name: measure.name.clone(),
        entry_type: "measure".to_string(),
        start_time: measure.start_time,
        duration: measure.duration,
    }));
    entries.sort_by(|left, right| {
        left.start_time
            .partial_cmp(&right.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    entries
}

pub fn get_entries_by_name(name: &str) -> Vec<String> {
    let marks = marks().lock().unwrap();
    let mark_names = marks
        .iter()
        .filter(|mark| mark.name == name)
        .map(|mark| mark.name.clone())
        .collect::<Vec<_>>();
    drop(marks);
    let measures = measures().lock().unwrap();
    let measure_names = measures
        .iter()
        .filter(|measure| measure.name == name)
        .map(|measure| measure.name.clone())
        .collect::<Vec<_>>();
    mark_names.into_iter().chain(measure_names).collect()
}

pub fn get_entries_by_name_entries(name: &str, entry_type: Option<&str>) -> Vec<PerformanceEntry> {
    get_entries()
        .into_iter()
        .filter(|entry| entry.name == name)
        .filter(|entry| entry_type.is_none_or(|entry_type| entry.entry_type == entry_type))
        .collect()
}

pub fn get_entries_by_type(entry_type: &str) -> Vec<PerformanceEntry> {
    get_entries()
        .into_iter()
        .filter(|entry| entry.entry_type == entry_type)
        .collect()
}

pub fn clear_marks(name: Option<&str>) {
    let mut marks = marks().lock().unwrap();
    if let Some(name) = name {
        marks.retain(|mark| mark.name != name);
    } else {
        marks.clear();
    }
}

pub fn clear_measures(name: Option<&str>) {
    let mut measures = measures().lock().unwrap();
    if let Some(name) = name {
        measures.retain(|measure| measure.name != name);
    } else {
        measures.clear();
    }
}

fn find_mark(name: &str) -> Option<PerformanceMark> {
    marks()
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find(|mark| mark.name == name)
        .cloned()
}

fn marks() -> &'static Mutex<Vec<PerformanceMark>> {
    MARKS.get_or_init(|| Mutex::new(Vec::new()))
}

fn measures() -> &'static Mutex<Vec<PerformanceMeasure>> {
    MEASURES.get_or_init(|| Mutex::new(Vec::new()))
}

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
