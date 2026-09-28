#![feature(rustc_private)]

extern crate rustc_span;
extern crate serde;

#[path = "../src/inputs.rs"]
mod inputs;

use std::path::PathBuf;

use inputs::{SourceFile, TrackedInputs};
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
    let inputs = TrackedInputs::new(2, Vec::new()).unwrap();
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
    let inputs = TrackedInputs::new(2, Vec::new()).unwrap();
    assert!(!inputs.file_exists(&path));
    std::fs::write(&path, b"present").unwrap();
    assert!(inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
}

#[test]
fn a_read_cannot_override_an_absent_lookup() {
    let path = path("created-before-read");
    let inputs = TrackedInputs::new(2, Vec::new()).unwrap();
    assert!(!inputs.file_exists(&path));
    std::fs::write(&path, b"present").unwrap();
    assert!(inputs.read_file(&path).is_err());
    assert!(inputs.snapshot().is_err());
}

#[test]
fn a_lookup_cannot_override_a_successful_read() {
    let path = path("removed-after-read");
    std::fs::write(&path, b"present").unwrap();
    let inputs = TrackedInputs::new(2, Vec::new()).unwrap();
    assert_eq!(inputs.read_file(&path).unwrap(), "present");
    std::fs::rename(&path, path.with_extension("moved")).unwrap();
    assert!(!inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
}

#[test]
fn changed_bytes_reject_the_whole_observation_set() {
    let path = path("changed-content");
    std::fs::write(&path, b"abcd").unwrap();
    let inputs = TrackedInputs::new(2, Vec::new()).unwrap();
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
    let inputs = TrackedInputs::new(1, Vec::new()).unwrap();
    assert_eq!(inputs.read_file(&path).unwrap(), "source");
    assert!(inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
    let missing = path.with_extension("missing");
    let inputs = TrackedInputs::new(1, Vec::new()).unwrap();
    assert!(!inputs.file_exists(&missing));
    assert_eq!(inputs.snapshot().unwrap().probes.len(), 1);
    assert!(inputs.file_exists(&path));
    assert!(inputs.snapshot().is_err());
}

#[test]
fn provided_sources_are_observed_without_filesystem_publication() {
    let source = path("provided.rs");
    let inputs = TrackedInputs::new(2, vec![SourceFile {
        path: source.to_str().unwrap().to_owned(), text: "source 🦀".to_owned(),
    }]).unwrap();
    assert!(!source.exists());
    assert!(inputs.file_exists(&source));
    assert_eq!(inputs.read_file(&source).unwrap(), "source 🦀");
    assert_eq!(&*inputs.read_binary_file(&source).unwrap(), "source 🦀".as_bytes());
    assert_eq!(inputs.snapshot().unwrap().files.len(), 1);
    assert!(!source.exists());
}

#[test]
fn a_provided_snapshot_does_not_overwrite_the_existing_file() {
    let source = path("published.rs");
    std::fs::write(&source, "old").unwrap();
    let inputs = TrackedInputs::new(2, vec![SourceFile {
        path: source.to_str().unwrap().to_owned(), text: "new".to_owned(),
    }]).unwrap();
    assert!(inputs.file_exists(&source));
    assert_eq!(inputs.read_file(&source).unwrap(), "new");
    assert_eq!(std::fs::read_to_string(&source).unwrap(), "old");
    assert_eq!(inputs.snapshot().unwrap().files.len(), 1);
}

#[test]
fn provided_paths_are_exact_unique_and_bounded() {
    let name = path("duplicate.rs").to_str().unwrap().to_owned();
    let sources = || vec![SourceFile { path: name.clone(), text: String::new() },
        SourceFile { path: name.clone(), text: String::new() }];
    assert!(TrackedInputs::new(2, sources()).is_err());
    assert!(TrackedInputs::new(1, sources()).is_err());
    assert!(TrackedInputs::new(1, vec![SourceFile { path: "relative.rs".to_owned(), text: String::new() }]).is_err());
    assert!(TrackedInputs::new(1, vec![SourceFile { path: format!("{name}\0"), text: String::new() }]).is_err());
}
