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
    let interfaces = os::network_interfaces().unwrap();
    assert!(interfaces
        .values()
        .flatten()
        .all(|interface| matches!(interface.family.as_str(), "IPv4" | "IPv6")));
}
