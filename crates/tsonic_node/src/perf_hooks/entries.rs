#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceMark {
    pub name: String,
    pub entry_type: &'static str,
    pub start_time: f64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceMeasure {
    pub name: String,
    pub entry_type: &'static str,
    pub start_time: f64,
    pub duration: f64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceMarkOptions {
    pub detail: Option<String>,
    pub start_time: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceMeasureOptions {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub duration: Option<f64>,
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
    pub worker_start: f64,
    pub delivery_type: Option<String>,
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
            worker_start: 0.0,
            delivery_type: None,
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
            (
                "nextHopProtocol".to_string(),
                self.next_hop_protocol.clone(),
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

