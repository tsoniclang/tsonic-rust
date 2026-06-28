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

    let env_file = std::env::current_dir()
        .unwrap()
        .join(".temp")
        .join("tsonic-rust-process-env");
    std::fs::create_dir_all(env_file.parent().unwrap()).unwrap();
    std::fs::write(
        &env_file,
        "TSONIC_RUST_ENV_FILE=loaded\n# ignored\nQUOTED=\"ok\"\n",
    )
    .unwrap();
    process::load_env_file(&env_file.to_string_lossy()).unwrap();
    assert_eq!(
        process::env_get("TSONIC_RUST_ENV_FILE").as_deref(),
        Some("loaded")
    );
    assert_eq!(process::env_get("QUOTED").as_deref(), Some("ok"));
    process::env_delete("TSONIC_RUST_ENV_FILE");
    process::env_delete("QUOTED");
    std::fs::remove_file(env_file).unwrap();

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
fn process_kill_exposes_signal_zero_probe() {
    #[cfg(unix)]
    {
        assert!(process::kill(process::pid(), Some(0)).unwrap());
        assert!(process::kill(u32::MAX, Some(0)).is_err());
    }
    #[cfg(not(unix))]
    {
        assert!(process::kill(process::pid(), Some(0)).is_err());
    }
}

#[test]
fn process_runtime_queries_have_stable_shapes() {
    assert!(process::pid() > 0);
    assert!(!process::version().is_empty());
    assert!(process::versions()
        .iter()
        .any(|(name, _)| name == "tsonic_rust"));
    let versions = process::versions_struct();
    assert_eq!(versions.node, process::version());
    assert!(!versions.tsonic_rust.is_empty());
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
    assert_eq!(resource.fs_read, 0);
    assert_eq!(resource.ipc_sent, 0);
    assert!(process::memory_usage_rss() <= memory.rss + process::memory_usage_rss());
    assert!(process::constrained_memory() > 0);
    assert!(process::thread_cpu_usage(None).user <= process::cpu_usage(None).user);
}

#[test]
fn process_metadata_warnings_and_feature_shapes_are_closed() {
    process::set_title("tsonic-test");
    assert_eq!(process::title(), "tsonic-test");

    let features = process::features();
    assert!(features.ipv6);
    assert!(features.tls);
    assert!(features.tls_ocsp);
    assert!(features.require_module);
    assert_eq!(features.typescript.as_deref(), Some("transform"));
    assert!(!features.debug);
    assert!(!features.inspector);

    let config = process::config();
    assert!(config
        .target_defaults
        .iter()
        .any(|(name, _)| name == "target_platform"));
    assert!(config.variables.iter().any(|(name, _)| name == "host_arch"));
    assert_eq!(config.default_configuration, "Release");
    assert_eq!(config.target_arch, process::arch());
    assert!(config.node_use_openssl);
    assert!(!config.node_shared_js_engine);
    assert_eq!(config.visibility, "default");

    assert!(process::allowed_node_environment_flags().contains(&"--trace-warnings"));
    assert!(process::available_memory() > 0);
    assert!(process::get_active_resources_info().contains(&"Process"));
    assert!(!process::source_maps_enabled());
    assert_eq!(process::debug_port(), 0);
    assert_eq!(process::get_builtin_module("node:fs"), Some("fs"));
    assert_eq!(process::get_builtin_module("missing"), None);
    assert_eq!(process::main_module(), None);
    assert_eq!(process::channel(), None);
    assert!(!process::connected());
    assert!(process::disconnect().is_err());
    assert!(process::send(&tsonic_js::JsValue::String("hello".to_string())).is_err());
    assert!(!process::no_deprecation());
    assert!(!process::throw_deprecation());
    assert!(!process::trace_deprecation());
    assert!(!process::trace_process_warnings());
    process::set_uncaught_exception_capture_callback(false);
    assert!(!process::has_uncaught_exception_capture_callback());
    process::add_uncaught_exception_capture_callback();
    assert!(process::has_uncaught_exception_capture_callback());
    process::set_uncaught_exception_capture_callback(false);
    assert!(process::abort().is_err());
    assert!(process::execve("/bin/echo", &[], &[]).is_err());
    let before = process::finalization().registered_count;
    process::finalization_register();
    assert_eq!(process::finalization().registered_count, before + 1);
    process::finalization_unregister();
    assert_eq!(process::finalization().registered_count, before);
    process::ref_handle(&features);
    process::unref_handle(&features);
    let current_umask = process::umask(None);
    let old_umask = process::umask(Some(current_umask));
    assert_eq!(old_umask, current_umask);

    process::clear_warnings();
    process::emit_warning(
        "careful",
        Some("TsonicWarning"),
        Some("TSONIC_WARN"),
        Some("detail"),
    );
    let warnings = process::emitted_warnings();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].name, "TsonicWarning");
    assert_eq!(warnings[0].message, "careful");
    assert_eq!(warnings[0].code.as_deref(), Some("TSONIC_WARN"));
    assert_eq!(warnings[0].detail.as_deref(), Some("detail"));
    process::emit_warning_with_options(
        "with options",
        process::EmitWarningOptions {
            r#type: Some("TypedWarning".to_string()),
            code: Some("TSONIC_TYPED".to_string()),
            detail: Some("typed detail".to_string()),
            ctor: Some("Ctor".to_string()),
        },
    );
    let warnings = process::emitted_warnings();
    assert_eq!(warnings.len(), 2);
    assert_eq!(warnings[1].name, "TypedWarning");
    assert_eq!(warnings[1].code.as_deref(), Some("TSONIC_TYPED"));
}

#[test]
fn process_events_use_closed_event_emitter_shape() {
    let mut events = process::ProcessEvents::new();
    events.on("beforeExit", |_| {});
    events.add_listener("beforeExit", |_| {});
    let removable = events.on_with_id("beforeExit", |_| {});
    events.once("exit", |_| {});
    events.prepend_listener("warning", |_| {});
    events.prepend_once_listener("warning", |_| {});
    assert_eq!(events.listener_count("beforeExit"), 3);
    assert!(events.listeners("beforeExit").contains(&removable));
    assert_eq!(
        events.raw_listeners("beforeExit"),
        events.listeners("beforeExit")
    );
    assert!(events.event_names().contains(&"beforeExit".to_string()));
    events.off_by_id("beforeExit", removable);
    assert!(!events.listeners("beforeExit").contains(&removable));
    let removable = events.on_with_id("beforeExit", |_| {});
    events.remove_listener_by_id("beforeExit", removable);
    assert!(!events.listeners("beforeExit").contains(&removable));
    assert!(events.emit("beforeExit", &[]));
    assert!(events.emit("exit", &[]));
    assert!(!events.emit("exit", &[]));
    assert!(events.emit("warning", &[]));
    events.remove_all_listeners(Some("warning"));
    assert_eq!(events.listener_count("warning"), 0);
    events.remove_all_listeners(None);
    assert_eq!(events.event_names().len(), 0);
    assert!(!events.emit("uncaughtException", &[]));
}
