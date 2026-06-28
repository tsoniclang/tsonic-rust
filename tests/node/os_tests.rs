use tsonic_node::os;

#[test]
fn os_wrappers_have_stable_shapes() {
    assert!(!os::platform().is_empty());
    assert!(!os::arch().is_empty());
    assert!(matches!(os::eol(), "\n" | "\r\n"));
    assert!(!os::tmpdir().unwrap().is_empty());
    assert!(!os::hostname().is_empty());
    assert!(!os::r#type().is_empty());
    let _version = os::version();
    let cpus = os::cpus();
    assert!(!cpus.is_empty());
    assert!(cpus.iter().all(|cpu| !cpu.model.is_empty()));
    assert_eq!(cpus.iter().map(|cpu| cpu.times.user).min().unwrap_or(0), 0);
    assert!(os::available_parallelism() >= 1);
    let loadavg = os::loadavg();
    assert_eq!(loadavg.len(), 3);
    assert!(loadavg
        .iter()
        .all(|value| value.is_finite() && *value >= 0.0));
    assert!(os::totalmem() >= os::freemem());
    assert!(os::uptime() >= 0.0);
    assert!(!os::machine().is_empty());
    assert!(matches!(os::endianness(), "LE" | "BE"));
    assert!(!os::dev_null().is_empty());
    let user = os::user_info();
    assert!(user.homedir.is_empty() || std::path::Path::new(&user.homedir).is_absolute());
    let user_with_options = os::user_info_with_options(Some(os::UserInfoOptions {
        encoding: Some("utf8".to_string()),
    }));
    assert_eq!(user.username, user_with_options.username);
    let constants = os::constants();
    assert_eq!(constants.priority.priority_normal, 0);
    assert!(constants.errno.contains_key("ENOENT"));
    assert!(constants.signals.contains_key("SIGTERM") || cfg!(not(unix)));
    assert!(constants.dlopen.contains_key("RTLD_NOW") || cfg!(not(unix)));
    assert_eq!(constants.uv.get("UV_UDP_REUSEADDR"), Some(&4));
    let interfaces = os::network_interfaces().unwrap();
    assert!(interfaces
        .values()
        .flatten()
        .all(|interface| matches!(interface.family.as_str(), "IPv4" | "IPv6")));
}
