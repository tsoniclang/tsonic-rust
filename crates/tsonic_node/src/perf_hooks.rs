use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();
static MARKS: OnceLock<Mutex<Vec<PerformanceMark>>> = OnceLock::new();
static MEASURES: OnceLock<Mutex<Vec<PerformanceMeasure>>> = OnceLock::new();
static RESOURCE_TIMING_BUFFER_SIZE: OnceLock<Mutex<usize>> = OnceLock::new();

pub fn performance_now() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

pub fn time_origin() -> f64 {
    0.0
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EventLoopUtilization {
    pub idle: f64,
    pub active: f64,
    pub utilization: f64,
}

pub fn event_loop_utilization(previous: Option<EventLoopUtilization>) -> EventLoopUtilization {
    let active = performance_now();
    let current = EventLoopUtilization {
        idle: 0.0,
        active,
        utilization: if active > 0.0 { 1.0 } else { 0.0 },
    };
    if let Some(previous) = previous {
        let active = (current.active - previous.active).max(0.0);
        EventLoopUtilization {
            idle: 0.0,
            active,
            utilization: if active > 0.0 { 1.0 } else { 0.0 },
        }
    } else {
        current
    }
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

impl PerformanceEntry {
    pub fn to_json(&self) -> Vec<(String, String)> {
        vec![
            ("name".to_string(), self.name.clone()),
            ("entryType".to_string(), self.entry_type.clone()),
            ("startTime".to_string(), self.start_time.to_string()),
            ("duration".to_string(), self.duration.to_string()),
        ]
    }
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

pub fn clear_resource_timings(_name: Option<&str>) {}

pub fn set_resource_timing_buffer_size(size: usize) {
    *resource_timing_buffer_size().lock().unwrap() = size;
}

pub fn resource_timing_buffer_size() -> &'static Mutex<usize> {
    RESOURCE_TIMING_BUFFER_SIZE.get_or_init(|| Mutex::new(250))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Histogram {
    values: Vec<u64>,
    enabled: bool,
}

impl Histogram {
    pub fn new() -> Self {
        Self {
            values: Vec::new(),
            enabled: true,
        }
    }

    pub fn record(&mut self, value: u64) {
        if self.enabled {
            self.values.push(value);
        }
    }

    pub fn record_delta(&mut self) {
        self.record(performance_now() as u64);
    }

    pub fn add(&mut self, other: &Histogram) {
        self.values.extend(other.values.iter().copied());
    }

    pub fn reset(&mut self) {
        self.values.clear();
    }

    pub fn enable(&mut self) -> bool {
        let previous = self.enabled;
        self.enabled = true;
        previous
    }

    pub fn disable(&mut self) -> bool {
        let previous = self.enabled;
        self.enabled = false;
        previous
    }

    pub fn count(&self) -> usize {
        self.values.len()
    }

    pub fn min(&self) -> u64 {
        self.values.iter().copied().min().unwrap_or(0)
    }

    pub fn max(&self) -> u64 {
        self.values.iter().copied().max().unwrap_or(0)
    }

    pub fn mean(&self) -> f64 {
        if self.values.is_empty() {
            0.0
        } else {
            self.values.iter().sum::<u64>() as f64 / self.values.len() as f64
        }
    }

    pub fn stddev(&self) -> f64 {
        if self.values.len() < 2 {
            return 0.0;
        }
        let mean = self.mean();
        let variance = self
            .values
            .iter()
            .map(|value| {
                let delta = *value as f64 - mean;
                delta * delta
            })
            .sum::<f64>()
            / self.values.len() as f64;
        variance.sqrt()
    }

    pub fn percentile(&self, percentile: f64) -> u64 {
        if self.values.is_empty() {
            return 0;
        }
        let mut values = self.values.clone();
        values.sort_unstable();
        let percentile = percentile.clamp(0.0, 100.0);
        let index = ((percentile / 100.0) * (values.len().saturating_sub(1) as f64)).round();
        values[index as usize]
    }
}

impl Default for Histogram {
    fn default() -> Self {
        Self::new()
    }
}

pub fn create_histogram() -> Histogram {
    Histogram::new()
}

pub type RecordableHistogram = Histogram;
pub type IntervalHistogram = Histogram;

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
