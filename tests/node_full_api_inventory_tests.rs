use std::collections::{BTreeMap, BTreeSet};

const INVENTORY: &str = include_str!("capabilities/node_api_full_inventory.csv");
const EXPECTED_ROW_COUNT: usize = 8_671;
const EXPECTED_PHASE1_COUNT: usize = 6_322;
const EXPECTED_LATER_COUNT: usize = 0;
const EXPECTED_HARD_REJECT_COUNT: usize = 2_349;

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
            matches!(row.phase.as_str(), "phase1" | "hard-reject"),
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
                | "namespace-function"
                | "namespace-const"
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
        "async_hooks",
        "buffer",
        "child_process",
        "console",
        "crypto",
        "diagnostics_channel",
        "dns",
        "dns/promises",
        "events",
        "fs",
        "fs/promises",
        "http",
        "http2",
        "https",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "querystring",
        "readline",
        "readline/promises",
        "stream",
        "stream/promises",
        "stream/web",
        "string_decoder",
        "timers",
        "timers/promises",
        "tls",
        "tty",
        "url",
        "util",
        "worker_threads",
        "zlib",
    ] {
        assert!(
            phase1_modules.contains(module),
            "phase one is missing high-use module {module}"
        );
    }
}

#[test]
fn framework_runtime_surfaces_are_phase_one_and_dynamic_surfaces_rejected() {
    let rows = rows();
    let modules = rows
        .iter()
        .map(|row| (row.module.as_str(), row.phase.as_str()))
        .collect::<BTreeSet<_>>();

    for module in [
        "async_hooks",
        "diagnostics_channel",
        "dns",
        "fs/promises",
        "http",
        "http2",
        "https",
        "net",
        "stream",
        "stream/promises",
        "timers",
        "timers/promises",
        "tls",
        "zlib",
    ] {
        assert!(
            modules.contains(&(module, "phase1")),
            "{module} should be explicitly inventoried as framework-ready phase1"
        );
    }
    for module in ["vm", "inspector", "repl", "v8", "trace_events", "test"] {
        assert!(
            modules.contains(&(module, "hard-reject")),
            "{module} should be explicitly inventoried as hard-reject"
        );
    }
}

#[test]
fn module_safe_helpers_are_phase_one_but_loader_hooks_are_rejected() {
    let rows = rows();
    assert!(
        rows.iter().any(|row| row.module == "module"
            && row.name == "createRequire"
            && row.phase == "phase1"),
        "module.createRequire should be framework-ready phase1"
    );
    assert!(
        rows.iter().any(|row| row.module == "module"
            && row.name == "deregister"
            && row.phase == "hard-reject"),
        "module hook APIs should stay hard-reject as dynamic loader machinery"
    );
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
