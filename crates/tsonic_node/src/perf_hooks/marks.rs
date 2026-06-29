pub fn mark(name: &str) -> PerformanceMark {
    mark_with_detail(name, None)
}

pub fn mark_with_detail(name: &str, detail: Option<String>) -> PerformanceMark {
    mark_with_options(
        name,
        Some(PerformanceMarkOptions {
            detail,
            start_time: None,
        }),
    )
}

pub fn mark_with_options(name: &str, options: Option<PerformanceMarkOptions>) -> PerformanceMark {
    let options = options.unwrap_or(PerformanceMarkOptions {
        detail: None,
        start_time: None,
    });
    let mark = PerformanceMark {
        name: name.to_string(),
        entry_type: "mark",
        start_time: options.start_time.unwrap_or_else(performance_now),
        detail: options.detail,
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
        entry_type: "measure",
        start_time,
        duration: (end_time - start_time).max(0.0),
        detail: None,
    };
    measures().lock().unwrap().push(measure.clone());
    measure
}

pub fn measure_with_options(name: &str, options: PerformanceMeasureOptions) -> PerformanceMeasure {
    let start_time = options.start.unwrap_or(0.0);
    let duration = options
        .duration
        .or_else(|| options.end.map(|end| (end - start_time).max(0.0)))
        .unwrap_or_else(|| (performance_now() - start_time).max(0.0));
    let measure = PerformanceMeasure {
        name: name.to_string(),
        entry_type: "measure",
        start_time,
        duration,
        detail: options.detail,
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
        entry_type: measure.entry_type.to_string(),
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
