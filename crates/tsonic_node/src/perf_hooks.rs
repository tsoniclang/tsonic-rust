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
}

#[derive(Debug, Clone, PartialEq)]
pub struct PerformanceMeasure {
    pub name: String,
    pub start_time: f64,
    pub duration: f64,
}

pub fn mark(name: &str) -> PerformanceMark {
    let mark = PerformanceMark {
        name: name.to_string(),
        start_time: performance_now(),
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
    };
    measures().lock().unwrap().push(measure.clone());
    measure
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
