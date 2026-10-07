import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeValueProjections } from "../../../../dist/backend/planner/program/native-value-projections.js";
import { printRustItem } from "../../../../dist/print/source/index.js";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("native value projection checks the exact output slot before cloning a concrete payload", { timeout: 300_000 }, () => {
  const item = planRustNativeValueProjections([], [
    { name: "Stored", type: { kind: "named", path: "Record" }, representation: { kind: "value" } },
  ]);
  const generated = printRustItem(item);
  assert.match(generated, /downcast_mut::<Option<Record>>/u);
  assert.doesNotMatch(generated, /downcast_ref|downcast_unchecked|TypeId|Box::/u);
  const project = writeGeneratedProject("checked-native-value-slot", [
    { path: "Cargo.toml", text: '[package]\nname = "checked_native_value_slot"\nversion = "0.1.0"\nedition = "2021"\n' },
    { path: "src/main.rs", text: `
extern crate alloc;
use std::sync::atomic::{AtomicUsize, Ordering};
static CLONES: AtomicUsize = AtomicUsize::new(0);
#[derive(Debug, PartialEq, Eq)]
struct Record { value: u64 }
impl Clone for Record {
    fn clone(&self) -> Self {
        CLONES.fetch_add(1, Ordering::Relaxed);
        Self { value: self.value }
    }
}
enum TsonicError { Stored(Record), Other }
${generated}
fn main() {
    let stored = TsonicError::Stored(Record { value: 9007199254740993 });
    assert!(stored.native_value::<u64>().is_none());
    assert_eq!(CLONES.load(Ordering::Relaxed), 0);
    assert_eq!(stored.native_value::<Record>(), Some(Record { value: 9007199254740993 }));
    assert_eq!(CLONES.load(Ordering::Relaxed), 1);
    assert!(stored.native_shared::<Record>().is_none());
    assert!(TsonicError::Other.native_value::<Record>().is_none());
    assert_eq!(CLONES.load(Ordering::Relaxed), 1);
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt", "--all"]);
  runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["run", "--locked", "--offline"]);
});
