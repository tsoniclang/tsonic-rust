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

    pub fn count_bigint(&self) -> u128 {
        self.count() as u128
    }

    pub fn min(&self) -> u64 {
        self.values.iter().copied().min().unwrap_or(0)
    }

    pub fn min_bigint(&self) -> u128 {
        self.min() as u128
    }

    pub fn max(&self) -> u64 {
        self.values.iter().copied().max().unwrap_or(0)
    }

    pub fn max_bigint(&self) -> u128 {
        self.max() as u128
    }

    pub fn exceeds(&self) -> u64 {
        0
    }

    pub fn exceeds_bigint(&self) -> u128 {
        0
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

    pub fn percentile_bigint(&self, percentile: f64) -> u128 {
        self.percentile(percentile) as u128
    }

    pub fn percentiles(&self) -> BTreeMap<u64, u64> {
        [0_u64, 50, 75, 90, 99, 100]
            .into_iter()
            .map(|percentile| (percentile, self.percentile(percentile as f64)))
            .collect()
    }

    pub fn percentiles_bigint(&self) -> BTreeMap<u128, u128> {
        self.percentiles()
            .into_iter()
            .map(|(percentile, value)| (percentile as u128, value as u128))
            .collect()
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
