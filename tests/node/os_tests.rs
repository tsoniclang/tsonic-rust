use tsonic_node::os;

#[test]
fn os_wrappers_have_stable_shapes() {
    assert!(!os::platform().is_empty());
    assert!(!os::arch().is_empty());
    assert!(matches!(os::eol(), "\n" | "\r\n"));
    assert!(!os::tmpdir().unwrap().is_empty());
    assert!(!os::cpus().is_empty());
    assert_eq!(os::loadavg().len(), 3);
    assert_eq!(os::totalmem(), 0);
    assert_eq!(os::freemem(), 0);
}
