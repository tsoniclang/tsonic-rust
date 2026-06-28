use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

const INVENTORY: &str = include_str!("capabilities/stage1_inventory.tsv");
const DEPENDENCY_ALLOWLIST: &str = include_str!("capabilities/dependency_allowlist.tsv");
const EXPECTED_ROW_COUNT: usize = 356;
const EXPECTED_IMPLEMENTED_COUNT: usize = 299;
const EXPECTED_DEFERRED_COUNT: usize = 0;
const EXPECTED_HARD_REJECT_COUNT: usize = 57;

#[derive(Clone, Debug)]
struct CapabilityRow {
    id: String,
    status: String,
    packet: String,
    rust_api: String,
    evidence: String,
    notes: String,
}

#[test]
fn stage1_inventory_has_complete_classification() {
    let rows = inventory_rows();
    assert_eq!(rows.len(), EXPECTED_ROW_COUNT);

    let mut counts = BTreeMap::<String, usize>::new();
    let mut ids = BTreeSet::<String>::new();
    for row in &rows {
        assert!(
            ids.insert(row.id.clone()),
            "duplicate capability id {}",
            row.id
        );
        assert!(
            matches!(row.status.as_str(), "implemented" | "later" | "hard-reject"),
            "unexpected status {} for {}",
            row.status,
            row.id
        );
        assert!(
            !row.packet.is_empty(),
            "missing packet owner for {}",
            row.id
        );
        *counts.entry(row.status.clone()).or_default() += 1;
    }

    assert_eq!(
        counts.get("implemented").copied().unwrap_or(0),
        EXPECTED_IMPLEMENTED_COUNT
    );
    assert_eq!(
        counts.get("later").copied().unwrap_or(0),
        EXPECTED_DEFERRED_COUNT
    );
    assert_eq!(
        counts.get("hard-reject").copied().unwrap_or(0),
        EXPECTED_HARD_REJECT_COUNT
    );
}

#[test]
fn implemented_rows_have_api_and_test_evidence() {
    for row in inventory_rows()
        .into_iter()
        .filter(|row| row.status == "implemented")
    {
        assert_ne!(
            row.rust_api, "n/a",
            "implemented row {} has no Rust API",
            row.id
        );
        assert!(
            !row.evidence.contains("DEFER-") && !row.evidence.contains("REJECT-"),
            "implemented row {} points at non-implemented evidence {}",
            row.id,
            row.evidence
        );
        assert!(
            row.evidence.contains("test")
                || row.evidence.contains("JS-")
                || row.evidence.contains("NODE-")
                || row.evidence.contains("error tests")
                || row.evidence.contains("object/json tests"),
            "implemented row {} has weak evidence {}",
            row.id,
            row.evidence
        );
    }
}

#[test]
fn deferred_and_hard_reject_rows_are_explicit() {
    for row in inventory_rows()
        .into_iter()
        .filter(|row| row.status == "later")
    {
        assert_eq!(
            row.rust_api, "n/a",
            "{} should not expose a Rust API yet",
            row.id
        );
        assert!(
            row.evidence.starts_with("LATER-NODE-"),
            "later row {} must use LATER-NODE evidence, got {}",
            row.id,
            row.evidence
        );
        assert!(!row.notes.is_empty(), "{} needs a reason", row.id);
    }
    for row in inventory_rows()
        .into_iter()
        .filter(|row| row.status == "hard-reject")
    {
        assert_eq!(
            row.rust_api, "n/a",
            "{} should not expose a Rust API",
            row.id
        );
        assert!(
            row.evidence.starts_with("REJECT-"),
            "{} row {} must use REJECT evidence, got {}",
            row.status,
            row.id,
            row.evidence
        );
        assert!(!row.notes.is_empty(), "{} needs a reason", row.id);
    }
}

#[test]
fn nested_test_files_are_wired_into_cargo_integration_tests() {
    let root = workspace_root();
    let integration_files = [
        root.join("tests/js_integration_tests.rs"),
        root.join("tests/node_integration_tests.rs"),
        root.join("tests/runtime_integration_tests.rs"),
    ];
    let integration_text = integration_files
        .iter()
        .map(|path| {
            fs::read_to_string(path).unwrap_or_else(|err| panic!("{}: {}", path.display(), err))
        })
        .collect::<Vec<_>>()
        .join("\n");

    for dir in ["js", "node", "runtime"] {
        let tests_dir = root.join("tests").join(dir);
        for file in rust_files_under(&tests_dir) {
            let relative = file.strip_prefix(root.join("tests")).unwrap();
            let path_text = relative.to_string_lossy().replace('\\', "/");
            assert!(
                integration_text.contains(&format!("#[path = \"{}\"]", path_text)),
                "{} is not wired into an integration test",
                path_text
            );
        }
    }
}

#[test]
fn product_crates_use_only_workspace_path_or_approved_dependencies() {
    let root = workspace_root();
    let allowlist = dependency_allowlist();
    for manifest in rust_files_under(&root.join("crates"))
        .into_iter()
        .filter(|path| path.file_name().and_then(|name| name.to_str()) == Some("Cargo.toml"))
    {
        let source = fs::read_to_string(&manifest)
            .unwrap_or_else(|err| panic!("{}: {}", manifest.display(), err));
        let crate_name = source
            .lines()
            .find_map(|line| line.trim().strip_prefix("name = "))
            .map(|value| value.trim_matches('"').to_string())
            .unwrap_or_else(|| panic!("{} missing package name", manifest.display()));
        let mut in_dependencies = false;
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                in_dependencies = trimmed == "[dependencies]";
                continue;
            }
            if !in_dependencies || trimmed.is_empty() {
                continue;
            }
            let dependency_name = trimmed
                .split_once('=')
                .map(|(name, _)| name.trim())
                .unwrap_or(trimmed);
            assert!(
                trimmed.contains("{ path = ")
                    || allowlist.contains(&(crate_name.clone(), dependency_name.to_string())),
                "{} has non-path dependency line `{}` without dependency_allowlist.tsv approval",
                manifest.display(),
                trimmed
            );
        }
    }
}

#[test]
fn dependency_allowlist_rows_are_specific_and_reasoned() {
    let rows = dependency_allowlist_rows();
    assert!(!rows.is_empty(), "dependency allowlist must be explicit");
    let mut seen = BTreeSet::new();
    for (crate_name, package, reason) in rows {
        assert!(
            seen.insert((crate_name.clone(), package.clone())),
            "duplicate dependency allowlist entry {crate_name}/{package}"
        );
        assert!(!crate_name.is_empty(), "allowlist crate missing");
        assert!(!package.is_empty(), "allowlist package missing");
        assert!(
            reason.contains("approved") && !reason.contains("temporary"),
            "{crate_name}/{package} needs a durable approved reason"
        );
    }
}

fn inventory_rows() -> Vec<CapabilityRow> {
    INVENTORY
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let columns = line.split('\t').collect::<Vec<_>>();
            assert_eq!(columns.len(), 6, "bad inventory row: {}", line);
            CapabilityRow {
                id: columns[0].to_string(),
                status: columns[1].to_string(),
                packet: columns[2].to_string(),
                rust_api: columns[3].to_string(),
                evidence: columns[4].to_string(),
                notes: columns[5].to_string(),
            }
        })
        .collect()
}

fn dependency_allowlist() -> BTreeSet<(String, String)> {
    dependency_allowlist_rows()
        .into_iter()
        .map(|(crate_name, package, _)| (crate_name, package))
        .collect()
}

fn dependency_allowlist_rows() -> Vec<(String, String, String)> {
    DEPENDENCY_ALLOWLIST
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let columns = line.split('\t').collect::<Vec<_>>();
            assert_eq!(columns.len(), 3, "bad dependency allowlist row: {line}");
            (
                columns[0].to_string(),
                columns[1].to_string(),
                columns[2].to_string(),
            )
        })
        .collect()
}

fn workspace_root() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut current = manifest_dir.to_path_buf();
    loop {
        if current.join("Cargo.toml").exists() && current.join("crates").is_dir() {
            return current;
        }
        current = current
            .parent()
            .unwrap_or_else(|| {
                panic!(
                    "unable to locate workspace root from {}",
                    manifest_dir.display()
                )
            })
            .to_path_buf();
    }
}

fn rust_files_under(root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs")
                || path.file_name().and_then(|name| name.to_str()) == Some("Cargo.toml")
            {
                result.push(path);
            }
        }
    }
    result
}
