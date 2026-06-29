pub fn allowed_node_environment_flags() -> Vec<&'static str> {
    vec![
        "--enable-source-maps",
        "--no-warnings",
        "--trace-warnings",
        "--unhandled-rejections",
    ]
}

pub fn available_memory() -> u64 {
    os::freemem()
}

pub fn get_active_resources_info() -> Vec<&'static str> {
    vec!["Process"]
}

pub fn emit_warning(message: &str, name: Option<&str>, code: Option<&str>, detail: Option<&str>) {
    warnings().lock().unwrap().push(ProcessWarning {
        name: name.unwrap_or("Warning").to_string(),
        message: message.to_string(),
        code: code.map(str::to_string),
        detail: detail.map(str::to_string),
    });
}

pub fn emit_warning_with_options(message: &str, options: EmitWarningOptions) {
    emit_warning(
        message,
        options.r#type.as_deref(),
        options.code.as_deref(),
        options.detail.as_deref(),
    );
}

pub fn emitted_warnings() -> Vec<ProcessWarning> {
    warnings().lock().unwrap().clone()
}

pub fn clear_warnings() {
    warnings().lock().unwrap().clear();
}

pub fn uptime() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64()
}

pub fn hrtime(previous: Option<(u64, u32)>) -> (u64, u32) {
    let elapsed = START.get_or_init(Instant::now).elapsed();
    let mut seconds = elapsed.as_secs();
    let mut nanos = elapsed.subsec_nanos();
    if let Some((previous_seconds, previous_nanos)) = previous {
        seconds = seconds.saturating_sub(previous_seconds);
        if nanos >= previous_nanos {
            nanos -= previous_nanos;
        } else if seconds > 0 {
            seconds -= 1;
            nanos = 1_000_000_000 + nanos - previous_nanos;
        } else {
            nanos = 0;
        }
    }
    (seconds, nanos)
}

pub fn hrtime_bigint() -> u128 {
    let elapsed = START.get_or_init(Instant::now).elapsed();
    u128::from(elapsed.as_secs()) * 1_000_000_000 + u128::from(elapsed.subsec_nanos())
}

pub fn versions_struct() -> ProcessVersions {
    ProcessVersions {
        node: version(),
        tsonic_rust: env!("CARGO_PKG_VERSION").to_string(),
        ares: String::new(),
        http_parser: String::new(),
        modules: String::new(),
        openssl: String::new(),
        uv: String::new(),
        js_engine: String::new(),
        zlib: String::new(),
    }
}

pub fn memory_usage() -> MemoryUsage {
    let rss = current_rss_bytes().unwrap_or(0);
    MemoryUsage {
        rss,
        heap_total: 0,
        heap_used: 0,
        external: 0,
        array_buffers: 0,
    }
}

pub fn cpu_usage(previous: Option<CpuUsage>) -> CpuUsage {
    let elapsed = START.get_or_init(Instant::now).elapsed();
    let total_micros = elapsed.as_micros() as u64;
    let current = CpuUsage {
        user: total_micros,
        system: 0,
    };
    if let Some(previous) = previous {
        CpuUsage {
            user: current.user.saturating_sub(previous.user),
            system: current.system.saturating_sub(previous.system),
        }
    } else {
        current
    }
}

pub fn resource_usage() -> ResourceUsage {
    let cpu = cpu_usage(None);
    ResourceUsage {
        user_cpu_time: cpu.user,
        system_cpu_time: cpu.system,
        max_rss: memory_usage().rss,
        shared_memory_size: 0,
        unshared_data_size: 0,
        unshared_stack_size: 0,
        minor_page_fault: 0,
        major_page_fault: 0,
        swapped_out: 0,
        fs_read: 0,
        fs_write: 0,
        ipc_sent: 0,
        ipc_received: 0,
        signals_count: 0,
        voluntary_context_switches: 0,
        involuntary_context_switches: 0,
    }
}

pub fn memory_usage_rss() -> u64 {
    memory_usage().rss
}

pub fn constrained_memory() -> u64 {
    available_memory()
}

pub fn thread_cpu_usage(previous: Option<CpuUsage>) -> CpuUsage {
    cpu_usage(previous)
}

pub fn env_get(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub fn env_set(name: &str, value: &str) {
    std::env::set_var(name, value);
}

pub fn env_delete(name: &str) {
    std::env::remove_var(name);
}

pub fn load_env_file(path: &str) -> NodeResult<()> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))?;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((name, value)) = trimmed.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"').trim_matches('\'');
        env_set(name.trim(), value);
    }
    Ok(())
}

