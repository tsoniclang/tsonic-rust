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
}
