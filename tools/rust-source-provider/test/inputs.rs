#![feature(rustc_private)]

extern crate rustc_driver;
extern crate rustc_span;
extern crate serde;

#[path = "../src/inputs.rs"]
mod inputs;

use std::path::PathBuf;

use inputs::TrackedInputs;
use rustc_span::source_map::FileLoader;

fn path(name: &str) -> PathBuf {
    let root = PathBuf::from(std::env::var_os("TSONIC_NATIVE_INPUT_TEST_ROOT").expect("test root"));
    std::fs::create_dir_all(&root).unwrap();
    root.join(name)
}

#[test]
fn stable_observations_are_idempotent() {
    let path = path("stable");
    std::fs::write(&path, b"source").unwrap();
    let inputs = TrackedInputs::new(2);
    for _ in 0..3 {
        assert!(inputs.file_exists(&path));
        assert_eq!(inputs.read_file(&path).unwrap(), "source");
        assert_eq!(&*inputs.read_binary_file(&path).unwrap(), b"source");
    }
    let snapshot = inputs.snapshot().unwrap();
    assert_eq!(snapshot.files.len(), 1);
    assert_eq!(snapshot.probes.len(), 1);
}

#[test]
fn contradictory_lookup_results_keep_the_native_result_but_reject_evidence() {
    let path = path("created-after-lookup");
    let inputs = TrackedInputs::new(2);
    assert!(!inputs.file_exists(&path));
    std::fs::write(&path, b"present").unwrap();
    assert!(inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
}

#[test]
fn a_read_cannot_override_an_absent_lookup() {
    let path = path("created-before-read");
    let inputs = TrackedInputs::new(2);
    assert!(!inputs.file_exists(&path));
    std::fs::write(&path, b"present").unwrap();
    assert!(inputs.read_file(&path).is_err());
    assert!(inputs.snapshot().is_err());
}

#[test]
fn a_lookup_cannot_override_a_successful_read() {
    let path = path("removed-after-read");
    std::fs::write(&path, b"present").unwrap();
    let inputs = TrackedInputs::new(2);
    assert_eq!(inputs.read_file(&path).unwrap(), "present");
    std::fs::rename(&path, path.with_extension("moved")).unwrap();
    assert!(!inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
}

#[test]
fn changed_bytes_reject_the_whole_observation_set() {
    let path = path("changed-content");
    std::fs::write(&path, b"abcd").unwrap();
    let inputs = TrackedInputs::new(2);
    assert_eq!(&*inputs.read_binary_file(&path).unwrap(), b"abcd");
    std::fs::write(&path, b"abce").unwrap();
    assert!(inputs.read_binary_file(&path).is_err());
    std::fs::write(&path, b"abcd").unwrap();
    assert!(inputs.snapshot().is_err());
}

#[test]
fn read_and_lookup_records_share_one_finite_budget() {
    let path = path("bounded");
    std::fs::write(&path, b"source").unwrap();
    let inputs = TrackedInputs::new(1);
    assert_eq!(inputs.read_file(&path).unwrap(), "source");
    assert!(inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
    let missing = path.with_extension("missing");
    let inputs = TrackedInputs::new(1);
    assert!(!inputs.file_exists(&missing));
    assert_eq!(inputs.snapshot().unwrap().probes.len(), 1);
    assert!(inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
}

#[test]
fn missing_sources_are_never_fabricated() {
    let source = path("absent.rs");
    let inputs = TrackedInputs::new(2);
    assert!(!source.exists());
    assert!(!inputs.file_exists(&source));
    assert!(inputs.read_file(&source).is_err());
    assert!(inputs.read_binary_file(&source).is_err());
    assert!(inputs.snapshot().unwrap().files.is_empty());
    assert!(!source.exists());
}

#[test]
fn tracked_and_ordinary_reads_observe_identical_actual_source() {
    let source = path("unicode.rs");
    let text = "source 🦀";
    std::fs::write(&source, text).unwrap();
    let inputs = TrackedInputs::new(2);
    assert!(inputs.file_exists(&source));
    assert_eq!(inputs.read_file(&source).unwrap(), std::fs::read_to_string(&source).unwrap());
    assert_eq!(&*inputs.read_binary_file(&source).unwrap(), std::fs::read(&source).unwrap());
    assert_eq!(std::fs::read_to_string(&source).unwrap(), text);
    assert_eq!(inputs.snapshot().unwrap().files.len(), 1);
}

#[test]
fn binary_inputs_keep_their_actual_non_unicode_bytes() {
    let source = path("bytes.bin");
    let bytes = [0, 128, 255, 10];
    std::fs::write(&source, bytes).unwrap();
    let inputs = TrackedInputs::new(2);
    assert!(inputs.file_exists(&source));
    assert!(inputs.read_file(&source).is_err());
    assert_eq!(&*inputs.read_binary_file(&source).unwrap(), bytes);
    assert_eq!(std::fs::read(&source).unwrap(), bytes);
    assert_eq!(inputs.snapshot().unwrap().files.len(), 1);
}
