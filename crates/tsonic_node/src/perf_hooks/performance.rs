use std::collections::BTreeMap;
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Performance {
    pub time_origin: f64,
}

impl Default for Performance {
    fn default() -> Self {
        Self::new()
    }
}

impl Performance {
    pub fn new() -> Self {
        Self {
            time_origin: time_origin(),
        }
    }

    pub fn now(&self) -> f64 {
        performance_now()
    }

    pub fn mark(&self, name: &str, options: Option<PerformanceMarkOptions>) -> PerformanceMark {
        mark_with_options(name, options)
    }

    pub fn measure(
        &self,
        name: &str,
        options: Option<PerformanceMeasureOptions>,
        end_mark: Option<&str>,
    ) -> PerformanceMeasure {
        if let Some(options) = options {
            measure_with_options(name, options)
        } else {
            measure(name, None, end_mark)
        }
    }

    pub fn get_entries(&self) -> Vec<PerformanceEntry> {
        get_entries()
    }

    pub fn get_entries_by_name(
        &self,
        name: &str,
        entry_type: Option<&str>,
    ) -> Vec<PerformanceEntry> {
        get_entries_by_name_entries(name, entry_type)
    }

    pub fn get_entries_by_type(&self, entry_type: &str) -> Vec<PerformanceEntry> {
        get_entries_by_type(entry_type)
    }

    pub fn clear_marks(&self, name: Option<&str>) {
        clear_marks(name);
    }

    pub fn clear_measures(&self, name: Option<&str>) {
        clear_measures(name);
    }

    pub fn clear_resource_timings(&self, name: Option<&str>) {
        clear_resource_timings(name);
    }

    pub fn set_resource_timing_buffer_size(&self, size: usize) {
        set_resource_timing_buffer_size(size);
    }

    pub fn node_timing(&self) -> PerformanceNodeTiming {
        node_timing()
    }

    pub fn event_loop_utilization(
        &self,
        previous: Option<EventLoopUtilization>,
    ) -> EventLoopUtilization {
        event_loop_utilization(previous)
    }

    pub fn to_json(&self) -> Vec<(String, String)> {
        vec![
            ("timeOrigin".to_string(), self.time_origin.to_string()),
            ("nodeTiming".to_string(), "available".to_string()),
        ]
    }
}

pub fn performance() -> Performance {
    Performance::new()
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
