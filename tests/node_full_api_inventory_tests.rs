use std::collections::{BTreeMap, BTreeSet};

const INVENTORY: &str = include_str!("capabilities/node_api_full_inventory.csv");
const EXPECTED_ROW_COUNT: usize = 7_741;
const EXPECTED_PHASE1_COUNT: usize = 1_157;
const EXPECTED_LATER_COUNT: usize = 4_086;
const EXPECTED_HARD_REJECT_COUNT: usize = 2_498;

#[derive(Debug)]
struct FullInventoryRow {
    id: String,
    module: String,
    kind: String,
    member_of: String,
    name: String,
    phase: String,
    reason: String,
    source_file: String,
    line: String,
    signature: String,
}

#[test]
fn full_node_api_inventory_is_visible_and_phase_classified() {
    let rows = rows();
    assert_eq!(rows.len(), EXPECTED_ROW_COUNT);

    let mut ids = BTreeSet::new();
    let mut counts = BTreeMap::<String, usize>::new();
    for row in &rows {
        assert!(ids.insert(row.id.clone()), "duplicate id {}", row.id);
        assert!(
            matches!(row.phase.as_str(), "phase1" | "later" | "hard-reject"),
            "bad phase for {}: {}",
            row.id,
            row.phase
        );
        assert!(!row.module.is_empty(), "{} missing module", row.id);
        assert!(!row.kind.is_empty(), "{} missing kind", row.id);
        assert!(!row.name.is_empty(), "{} missing name", row.id);
        if matches!(
            row.kind.as_str(),
            "method"
                | "property"
                | "indexer"
                | "constructor"
                | "inline-method"
                | "inline-property"
                | "inline-indexer"
        ) {
            assert!(!row.member_of.is_empty(), "{} missing member_of", row.id);
        }
        assert!(!row.reason.is_empty(), "{} missing reason", row.id);
        assert!(
            !row.source_file.is_empty(),
            "{} missing source_file",
            row.id
        );
        assert!(!row.line.is_empty(), "{} missing line", row.id);
        assert!(!row.signature.is_empty(), "{} missing signature", row.id);
        *counts.entry(row.phase.clone()).or_default() += 1;
    }

    assert_eq!(
        counts.get("phase1").copied().unwrap_or(0),
        EXPECTED_PHASE1_COUNT
    );
    assert_eq!(
        counts.get("later").copied().unwrap_or(0),
        EXPECTED_LATER_COUNT
    );
    assert_eq!(
        counts.get("hard-reject").copied().unwrap_or(0),
        EXPECTED_HARD_REJECT_COUNT
    );
}

#[test]
fn phase_one_contains_high_use_node_modules() {
    let rows = rows();
    let phase1_modules = rows
        .iter()
        .filter(|row| row.phase == "phase1")
        .map(|row| row.module.as_str())
        .collect::<BTreeSet<_>>();

    for module in [
        "assert",
        "buffer",
        "console",
        "crypto",
        "fs",
        "os",
        "path",
        "perf_hooks",
        "process",
        "querystring",
        "string_decoder",
        "tty",
        "url",
        "util",
    ] {
        assert!(
            phase1_modules.contains(module),
            "phase one is missing high-use module {module}"
        );
    }
}

#[test]
fn event_loop_network_and_vm_surfaces_are_not_hidden() {
    let rows = rows();
    let modules = rows
        .iter()
        .map(|row| (row.module.as_str(), row.phase.as_str()))
        .collect::<BTreeSet<_>>();

    for module in ["http", "https", "net", "stream", "events"] {
        assert!(
            modules.contains(&(module, "later")),
            "{module} should be explicitly inventoried as later"
        );
    }
    for module in ["vm", "inspector", "worker_threads", "child_process"] {
        assert!(
            modules.contains(&(module, "hard-reject")),
            "{module} should be explicitly inventoried as hard-reject"
        );
    }
}

fn rows() -> Vec<FullInventoryRow> {
    parse_csv(INVENTORY)
        .into_iter()
        .skip(1)
        .filter(|row| !row.iter().all(|value| value.is_empty()))
        .map(|columns| {
            assert_eq!(columns.len(), 10, "bad full inventory row: {columns:?}");
            FullInventoryRow {
                id: columns[0].clone(),
                module: columns[1].clone(),
                kind: columns[2].clone(),
                member_of: columns[3].clone(),
                name: columns[4].clone(),
                phase: columns[5].clone(),
                reason: columns[6].clone(),
                source_file: columns[7].clone(),
                line: columns[8].clone(),
                signature: columns[9].clone(),
            }
        })
        .collect()
}

fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = text.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                row.push(std::mem::take(&mut field));
            }
            '\n' if !in_quotes => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\r' if !in_quotes => {}
            _ => field.push(ch),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}
