use std::collections::{BTreeMap, BTreeSet};

const INVENTORY: &str = include_str!("capabilities/node_api_inventory.tsv");
const FULL_INVENTORY: &str = include_str!("capabilities/node_api_full_inventory.csv");
const EXPECTED_ROW_COUNT: usize = 4799;

#[derive(Debug)]
struct NodeApiRow<'a> {
    id: &'a str,
    module: &'a str,
    api: &'a str,
    status: &'a str,
    packet: &'a str,
    rust_api: &'a str,
    evidence: &'a str,
    reason: &'a str,
}

#[test]
fn node_api_inventory_is_complete_classified_and_owned() {
    let rows = rows();
    assert_eq!(rows.len(), EXPECTED_ROW_COUNT);

    let mut ids = BTreeSet::new();
    let mut by_status = BTreeMap::<&str, usize>::new();
    for row in &rows {
        assert!(ids.insert(row.id), "duplicate node inventory id {}", row.id);
        assert!(
            matches!(row.status, "implemented" | "later" | "hard-reject"),
            "{} has invalid status {}",
            row.id,
            row.status
        );
        assert!(!row.module.is_empty(), "{} missing module", row.id);
        assert!(!row.api.is_empty(), "{} missing api", row.id);
        assert!(!row.packet.is_empty(), "{} missing packet", row.id);
        assert!(!row.reason.is_empty(), "{} missing reason", row.id);
        *by_status.entry(row.status).or_default() += 1;
    }

    assert_eq!(by_status.get("implemented").copied().unwrap_or(0), 4786);
    assert_eq!(by_status.get("later").copied().unwrap_or(0), 0);
    assert_eq!(by_status.get("hard-reject").copied().unwrap_or(0), 13);
}

#[test]
fn closed_modules_have_exact_phase_one_declaration_rows() {
    assert_phase_one_declarations_are_mapped("buffer");
    assert_phase_one_declarations_are_mapped("https");
}

#[test]
fn implemented_node_api_rows_have_runtime_api_and_evidence() {
    for row in rows().into_iter().filter(|row| row.status == "implemented") {
        assert_ne!(row.rust_api, "n/a", "{} missing Rust API", row.id);
        assert!(
            row.evidence.starts_with("NODE-") || row.evidence.starts_with("JS-"),
            "{} has weak evidence {}",
            row.id,
            row.evidence
        );
    }
}

#[test]
fn hard_rejected_node_api_rows_have_explicit_reject_reason() {
    for row in rows().into_iter().filter(|row| row.status == "hard-reject") {
        assert_eq!(row.rust_api, "n/a", "{} must not expose API", row.id);
        assert!(
            row.evidence.starts_with("REJECT-NODE-"),
            "{} must use REJECT-NODE evidence",
            row.id
        );
    }
}

#[test]
fn later_node_api_rows_have_explicit_future_scope() {
    for row in rows().into_iter().filter(|row| row.status == "later") {
        assert_eq!(row.rust_api, "n/a", "{} must not expose API yet", row.id);
        assert!(
            row.evidence.starts_with("LATER-NODE-"),
            "{} must use LATER-NODE evidence",
            row.id
        );
    }
}

#[test]
fn broad_synchronous_fs_surface_is_not_missing_from_inventory() {
    let rows = rows();
    let implemented_fs_apis = rows
        .iter()
        .filter(|row| row.module == "fs" && row.status == "implemented")
        .map(|row| row.api.split_whitespace().next().unwrap_or(row.api))
        .collect::<BTreeSet<_>>();

    for api in [
        "accessSync",
        "appendFileSync",
        "chmodSync",
        "closeSync",
        "copyFileSync",
        "cpSync",
        "existsSync",
        "fdatasyncSync",
        "fstatSync",
        "fsyncSync",
        "ftruncateSync",
        "lstatSync",
        "mkdirSync",
        "mkdtempSync",
        "openSync",
        "opendirSync",
        "readFileSync",
        "readdirSync",
        "readlinkSync",
        "readSync",
        "realpathSync",
        "renameSync",
        "rmSync",
        "rmdirSync",
        "statSync",
        "symlinkSync",
        "truncateSync",
        "unlinkSync",
        "writeFileSync",
        "writeSync",
    ] {
        assert!(
            implemented_fs_apis.contains(api),
            "missing broad sync fs API {api}"
        );
    }
}

fn rows() -> Vec<NodeApiRow<'static>> {
    INVENTORY
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let columns = line.split('\t').collect::<Vec<_>>();
            assert_eq!(columns.len(), 8, "bad node inventory row: {line}");
            NodeApiRow {
                id: columns[0],
                module: columns[1],
                api: columns[2],
                status: columns[3],
                packet: columns[4],
                rust_api: columns[5],
                evidence: columns[6],
                reason: columns[7],
            }
        })
        .collect()
}

fn assert_phase_one_declarations_are_mapped(module: &str) {
    let implemented_apis = rows()
        .into_iter()
        .filter(|row| row.module == module && row.status == "implemented")
        .map(|row| row.api.to_string())
        .collect::<BTreeSet<_>>();

    let missing = full_rows()
        .into_iter()
        .filter(|row| row.module == module && row.phase == "phase1")
        .filter_map(|row| {
            let api = full_inventory_api(&row);
            if implemented_apis.contains(&api) {
                None
            } else {
                Some(format!("{} {}", row.id, api))
            }
        })
        .collect::<Vec<_>>();

    assert!(
        missing.is_empty(),
        "{module} has unmapped phase-one declarations: {missing:?}"
    );
}

#[derive(Debug)]
struct FullInventoryRow {
    id: String,
    module: String,
    kind: String,
    member_of: String,
    name: String,
    phase: String,
}

fn full_rows() -> Vec<FullInventoryRow> {
    parse_csv(FULL_INVENTORY)
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
            }
        })
        .collect()
}

fn full_inventory_api(row: &FullInventoryRow) -> String {
    match row.kind.as_str() {
        "module" => "module".to_string(),
        "export-function" | "namespace-function" | "export-const" | "namespace-const" => {
            row.name.clone()
        }
        _ if !row.member_of.is_empty() => format!("{}.{}", row.member_of, row.name),
        _ => row.name.clone(),
    }
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

    if in_quotes || !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }

    rows
}
