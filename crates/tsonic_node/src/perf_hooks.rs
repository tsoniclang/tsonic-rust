use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();
static MARKS: OnceLock<Mutex<Vec<PerformanceMark>>> = OnceLock::new();
static MEASURES: OnceLock<Mutex<Vec<PerformanceMeasure>>> = OnceLock::new();
static RESOURCES: OnceLock<Mutex<Vec<PerformanceResourceTiming>>> = OnceLock::new();
static RESOURCE_TIMING_BUFFER_SIZE: OnceLock<Mutex<usize>> = OnceLock::new();

pub fn performance_now() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

pub fn time_origin() -> f64 {
    0.0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PerformanceConstants {
    pub node_performance_gc_major: u32,
    pub node_performance_gc_minor: u32,
    pub node_performance_gc_incremental: u32,
    pub node_performance_gc_weakcb: u32,
    pub node_performance_gc_flags_no: u32,
    pub node_performance_gc_flags_construct_retained: u32,
    pub node_performance_gc_flags_forced: u32,
    pub node_performance_gc_flags_synchronous_phantom_processing: u32,
    pub node_performance_gc_flags_all_available_garbage: u32,
    pub node_performance_gc_flags_all_external_memory: u32,
    pub node_performance_gc_flags_schedule_idle: u32,
}

pub const CONSTANTS: PerformanceConstants = PerformanceConstants {
    node_performance_gc_major: 4,
    node_performance_gc_minor: 1,
    node_performance_gc_incremental: 8,
    node_performance_gc_weakcb: 16,
    node_performance_gc_flags_no: 0,
    node_performance_gc_flags_construct_retained: 2,
    node_performance_gc_flags_forced: 4,
    node_performance_gc_flags_synchronous_phantom_processing: 8,
    node_performance_gc_flags_all_available_garbage: 16,
    node_performance_gc_flags_all_external_memory: 32,
    node_performance_gc_flags_schedule_idle: 64,
};

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

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceResourceTiming {
    pub name: String,
    pub initiator_type: String,
    pub start_time: f64,
    pub duration: f64,
    pub redirect_start: f64,
    pub redirect_end: f64,
    pub fetch_start: f64,
    pub domain_lookup_start: f64,
    pub domain_lookup_end: f64,
    pub connect_start: f64,
    pub connect_end: f64,
    pub secure_connection_start: f64,
    pub request_start: f64,
    pub response_start: f64,
    pub response_end: f64,
    pub transfer_size: u64,
    pub encoded_body_size: u64,
    pub decoded_body_size: u64,
    pub response_status: u16,
    pub next_hop_protocol: String,
}

impl PerformanceResourceTiming {
    pub fn new(name: &str, initiator_type: &str, start_time: f64, duration: f64) -> Self {
        Self {
            name: name.to_string(),
            initiator_type: initiator_type.to_string(),
            start_time,
            duration,
            redirect_start: 0.0,
            redirect_end: 0.0,
            fetch_start: start_time,
            domain_lookup_start: 0.0,
            domain_lookup_end: 0.0,
            connect_start: 0.0,
            connect_end: 0.0,
            secure_connection_start: 0.0,
            request_start: 0.0,
            response_start: 0.0,
            response_end: start_time + duration,
            transfer_size: 0,
            encoded_body_size: 0,
            decoded_body_size: 0,
            response_status: 0,
            next_hop_protocol: String::new(),
        }
    }

    pub fn to_entry(&self) -> PerformanceEntry {
        PerformanceEntry {
            name: self.name.clone(),
            entry_type: "resource".to_string(),
            start_time: self.start_time,
            duration: self.duration,
        }
    }

    pub fn to_json(&self) -> Vec<(String, String)> {
        vec![
            ("name".to_string(), self.name.clone()),
            ("entryType".to_string(), "resource".to_string()),
            ("initiatorType".to_string(), self.initiator_type.clone()),
            ("startTime".to_string(), self.start_time.to_string()),
            ("duration".to_string(), self.duration.to_string()),
            (
                "responseStatus".to_string(),
                self.response_status.to_string(),
            ),
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UVMetrics {
    pub loop_count: u64,
    pub events: u64,
    pub events_waiting: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PerformanceNodeTiming {
    pub node_start: f64,
    pub engine_start: f64,
    pub environment: f64,
    pub loop_start: f64,
    pub loop_exit: f64,
    pub bootstrap_complete: f64,
    pub idle_time: f64,
    pub uv_metrics_info: UVMetrics,
}

pub fn node_timing() -> PerformanceNodeTiming {
    let now = performance_now();
    PerformanceNodeTiming {
        node_start: 0.0,
        engine_start: 0.0,
        environment: 0.0,
        loop_start: 0.0,
        loop_exit: now,
        bootstrap_complete: 0.0,
        idle_time: 0.0,
        uv_metrics_info: UVMetrics {
            loop_count: 0,
            events: 0,
            events_waiting: 0,
        },
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
    drop(measures);
    let resources = resources().lock().unwrap();
    entries.extend(resources.iter().map(PerformanceResourceTiming::to_entry));
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

pub fn clear_resource_timings(name: Option<&str>) {
    let mut resources = resources().lock().unwrap();
    if let Some(name) = name {
        resources.retain(|resource| resource.name != name);
    } else {
        resources.clear();
    }
}

pub fn add_resource_timing(resource: PerformanceResourceTiming) -> PerformanceResourceTiming {
    let max_size = *resource_timing_buffer_size().lock().unwrap();
    let mut resources = resources().lock().unwrap();
    if resources.len() < max_size {
        resources.push(resource.clone());
    }
    resource
}

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

pub fn timerify<R>(name: &str, callback: impl FnOnce() -> R) -> (R, PerformanceEntry) {
    let start_time = performance_now();
    let result = callback();
    let duration = (performance_now() - start_time).max(0.0);
    let entry = PerformanceEntry {
        name: name.to_string(),
        entry_type: "function".to_string(),
        start_time,
        duration,
    };
    (result, entry)
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

fn resources() -> &'static Mutex<Vec<PerformanceResourceTiming>> {
    RESOURCES.get_or_init(|| Mutex::new(Vec::new()))
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
