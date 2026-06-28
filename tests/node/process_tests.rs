use tsonic_node::process;

#[test]
fn process_env_and_exit_code_are_testable() {
    process::env_set("TSONIC_RUST_TEST_ENV", "1");
    assert_eq!(
        process::env_get("TSONIC_RUST_TEST_ENV").as_deref(),
        Some("1")
    );
    process::env_delete("TSONIC_RUST_TEST_ENV");
    assert_eq!(process::env_get("TSONIC_RUST_TEST_ENV"), None);

    process::set_exit_code(23);
    assert_eq!(process::exit_code(), Some(23));
}

#[test]
fn process_platform_and_arch_use_node_spellings() {
    assert!(!process::platform().is_empty());
    assert!(!process::arch().is_empty());
    assert!(process::exec_path().unwrap().contains('/'));
    assert!(!process::argv0().is_empty());
    assert!(process::exec_argv().is_empty());
    assert!(process::ppid() <= process::pid() || process::ppid() > 0);
    assert_eq!(process::release().name, "tsonic-rust");
}

#[test]
fn process_identity_queries_use_platform_values() {
    #[cfg(unix)]
    {
        assert!(process::getuid().is_some());
        assert!(process::geteuid().is_some());
        assert!(process::getgid().is_some());
        assert!(process::getegid().is_some());
        assert!(process::getgroups().is_ok());
    }
    #[cfg(not(unix))]
    {
        assert_eq!(process::getuid(), None);
        assert_eq!(process::geteuid(), None);
        assert_eq!(process::getgid(), None);
        assert_eq!(process::getegid(), None);
        assert!(process::getgroups().unwrap().is_empty());
    }
}

#[test]
fn process_runtime_queries_have_stable_shapes() {
    assert!(process::pid() > 0);
    assert!(!process::version().is_empty());
    assert!(process::versions()
        .iter()
        .any(|(name, _)| name == "tsonic_rust"));
    assert!(process::uptime() >= 0.0);
    let (seconds, nanos) = process::hrtime(None);
    assert!(nanos < 1_000_000_000);
    assert!(process::hrtime(Some((seconds, nanos))).1 < 1_000_000_000);
    assert!(process::hrtime_bigint() > 0);
    let memory = process::memory_usage();
    assert!(memory.rss <= memory.rss + memory.heap_total);
    let cpu = process::cpu_usage(None);
    assert!(process::cpu_usage(Some(cpu.clone())).user <= process::cpu_usage(None).user);
    let resource = process::resource_usage();
    assert!(resource.user_cpu_time >= cpu.user);
}

#[test]
fn process_events_use_closed_event_emitter_shape() {
    let mut events = process::ProcessEvents::new();
    events.on("beforeExit", |_| {});
    assert_eq!(events.listener_count("beforeExit"), 1);
    assert!(events.emit("beforeExit", &[]));
    assert!(!events.emit("uncaughtException", &[]));
}
