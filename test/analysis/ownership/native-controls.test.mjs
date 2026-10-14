import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { nativeFunction, nativeMethods } from "../../helpers/native-ast.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("selected native moves, borrows and inferred Clone have exactly their handwritten physical costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "lib", crateName: "ownership_control" } },
    files: { "index.ts": [
      'import { hashptr } from "@tsonic/core/lang.js";',
      'import type { Pointer } from "@tsonic/core/types.js";',
      "export function single<T>(value: T): T { return value; }",
      "export function duplicated<T>(value: T): [T,T] { return [value, value]; }",
      "export function hash<T>(pointer: Pointer<T> | undefined): number { return hashptr(pointer); }",
    ].join("\n") },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(nativeMethods(nativeFunction(result, "single"), "clone").length, 0);
  assert.equal(nativeMethods(nativeFunction(result, "duplicated"), "clone").length, 1);
  assert.equal(nativeMethods(nativeFunction(result, "hash"), "clone").length, 0);
  const directory = writeGeneratedProject("selected-ownership-native", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/ownership.rs"), `
use ownership_control::index::{duplicated, hash, single};
use std::cell::Cell;

struct NoClone(u32);
struct Counted<'owner> {
    clones: &'owner Cell<usize>,
    drops: &'owner Cell<usize>,
}

impl Clone for Counted<'_> {
    fn clone(&self) -> Self {
        self.clones.set(self.clones.get() + 1);
        Self { clones: self.clones, drops: self.drops }
    }
}

impl Drop for Counted<'_> {
    fn drop(&mut self) { self.drops.set(self.drops.get() + 1); }
}

fn handwritten<T: Clone>(value: T) -> (T, T) { (value.clone(), value) }

#[test]
fn exact_native_contracts_and_costs() {
    assert_eq!(single(NoClone(7)).0, 7);
    let _ = hash::<NoClone>(None);
    let clones = Cell::new(0);
    let drops = Cell::new(0);
    let output = duplicated(Counted { clones: &clones, drops: &drops });
    assert_eq!(clones.get(), 1);
    assert_eq!(drops.get(), 0);
    drop(output);
    assert_eq!(drops.get(), 2);
    let expected_clones = Cell::new(0);
    let expected_drops = Cell::new(0);
    let expected = handwritten(Counted { clones: &expected_clones, drops: &expected_drops });
    assert_eq!(clones.get(), expected_clones.get());
    drop(expected);
    assert_eq!(drops.get(), expected_drops.get());
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["test", "--locked", "--offline", "--test", "ownership"]);
});
