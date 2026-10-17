import assert from "node:assert/strict";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { nativeFunction, nativeMethods } from "../../helpers/native-ast.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustProviderPackage } from "../../../dist/public/provider.js";

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
  assertNoTargetDiagnostics(result.diagnostics);
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

test("borrowed native helper environments retain NoClone payloads without hidden snapshots", { timeout: 300_000 }, () => {
  const fixtureRoot = writeGeneratedProject("ownership-no-clone-provider", [
    { path: "Cargo.toml", text: '[package]\nname = "ownership_fixture"\nversion = "0.0.0"\nedition = "2021"\n' },
    { path: "src/lib.rs", text: `use std::cell::Cell;
use std::rc::Rc;

pub struct NoClone {
    value: i32,
    reads: Rc<Cell<usize>>,
    drops: Rc<Cell<usize>>,
}

impl NoClone {
    pub fn new(value: i32, reads: Rc<Cell<usize>>, drops: Rc<Cell<usize>>) -> Self {
        Self { value, reads, drops }
    }

    pub fn value(&self) -> i32 { self.value }
}

impl Drop for NoClone {
    fn drop(&mut self) { self.drops.set(self.drops.get() + 1); }
}

pub fn observe(value: &NoClone) -> i32 {
    value.reads.set(value.reads.get() + 1);
    value.value
}

pub fn advance(value: &mut NoClone) -> i32 {
    value.reads.set(value.reads.get() + 1);
    value.value += 1;
    value.value
}
` },
  ]);
  const carrier = { kind: "target-named", id: "ownership.fixture.NoClone" };
  const provider = createRustProviderPackage({
    id: "ownership-no-clone", displayName: "Native NoClone ownership control", version: "1.0.0",
    modules: [{ moduleSpecifier: "@ownership/native", providerModuleId: "ownership.native", exports: [
      { id: "@ownership/native::NoClone", name: "NoClone", kind: "class", members: [] },
      { id: "@ownership/native::observe", name: "observe", kind: "function", signatures: [{
        id: "@ownership/native::observe(value)", name: "observe",
        parameters: [{ name: "value", type: { kind: "provider-ref", moduleSpecifier: "@ownership/native", exportName: "NoClone" } }],
        returnType: { kind: "source-primitive", name: "int32" },
      }] },
      { id: "@ownership/native::advance", name: "advance", kind: "function", signatures: [{
        id: "@ownership/native::advance(value)", name: "advance",
        parameters: [{ name: "value", type: { kind: "provider-ref", moduleSpecifier: "@ownership/native", exportName: "NoClone" } }],
        returnType: { kind: "source-primitive", name: "int32" },
      }] },
    ] }],
    types: [{ exportId: "@ownership/native::NoClone", targetCarrier: carrier }],
    carrierPaths: { "ownership.fixture.NoClone": "ownership_fixture::NoClone" },
    carrierTraits: { "ownership.fixture.NoClone": { implementations: [] } },
    operations: [{ exportId: "@ownership/native::observe", operationKind: "method",
      target: { form: "call", path: "ownership_fixture::observe", argModes: ["ref"] },
      parameterCarriers: [carrier], resultCarrier: { kind: "source-primitive", name: "int32" },
      resultLoans: { kind: "complete", declarationIdentity: "ownership_fixture::observe",
        resultTypeIdentity: "i32", valueTypeIdentity: "i32", loans: [] },
    }, { exportId: "@ownership/native::advance", operationKind: "method",
      target: { form: "call", path: "ownership_fixture::advance", argModes: ["mut-ref"] },
      parameterCarriers: [carrier], resultCarrier: { kind: "source-primitive", name: "int32" },
      resultLoans: { kind: "complete", declarationIdentity: "ownership_fixture::advance",
        resultTypeIdentity: "i32", valueTypeIdentity: "i32", loans: [] },
    }],
    crates: [{ crateName: "ownership_fixture", cargoPath: fixtureRoot }],
  });
  const { result } = compileRust({ packages: [provider],
    target: { id: "rust", options: { outputType: "lib", crateName: "ownership_borrow_control" } },
    files: { "index.ts": `import { NoClone, observe, advance } from "@ownership/native";
import type { int32 } from "@tsonic/core/types.js";
export function borrowed(value: NoClone): NoClone {
  function read(): int32 { return observe(value); }
  read();
  return value;
}
export function repeated(value: NoClone): NoClone {
  function read(): int32 { return observe(value); }
  read(); read();
  return value;
}
export function transferred(value: NoClone): NoClone {
  function once(): NoClone { return value; }
  return once();
}
export function mutated(value: NoClone): NoClone {
  function update(): int32 { return advance(value); }
  update();
  return value;
}
class Holder {
  constructor(public value: NoClone) {
    function erased(): void { value = value; }
  }
}
export function constructed(value: NoClone): NoClone {
  return new Holder(value).value;
}` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  for (const name of ["borrowed", "repeated", "transferred", "mutated", "constructed"]) {
    assert.equal(nativeMethods(nativeFunction(result, name), "clone").length, 0,
      `${name}: the native ownership contract does not allocate a payload snapshot`);
  }
  assert.equal(/\b(?:Location::allocate|Rc::new|RefCell::new|Box::new)\b/u.test(artifactText(result, "src/index.rs")), false,
    "the direct native helper environments need no heap-backed capture wrapper");
  const refused = compileRust({ packages: [provider],
    target: { id: "rust", options: { outputType: "lib", crateName: "ownership_borrow_negative" } },
    files: { "index.ts": `import { NoClone } from "@ownership/native";
export function duplicated(value: NoClone): [NoClone, NoClone] { return [value, value]; }` },
  }).result;
  assert.equal(refused.diagnostics.some(diagnostic => diagnostic.code === "RUST_CALLABLE_CONTRACT_CLOSURE_REJECTED" &&
    diagnostic.message === "A generated Rust operation requires an exact Rust Clone implementation that its exact target carrier does not provide."), true,
    "a real duplicated owned NoClone read remains rejected at its analysis owner: " +
      refused.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
  assert.equal(refused.artifacts.length, 0, "unavailable owned snapshots produce no partial native output");
  assert.equal(refused.program === undefined, true, "the real missing native Clone is rejected before publication");
  const directory = writeGeneratedProject("borrowed-no-clone-environments", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/borrowed.rs"), `use ownership_borrow_control::index::{borrowed, constructed, mutated, repeated, transferred};
use ownership_fixture::{advance, observe, NoClone};
use std::cell::Cell;
use std::rc::Rc;

fn handwritten_borrowed(value: NoClone) -> NoClone {
    let _ = observe(&value);
    value
}

fn handwritten_repeated(value: NoClone) -> NoClone {
    let _ = observe(&value);
    let _ = observe(&value);
    value
}

fn handwritten_transferred(value: NoClone) -> NoClone { value }

fn handwritten_constructed(value: NoClone) -> NoClone { value }

fn handwritten_mutated(mut value: NoClone) -> NoClone {
    let _ = advance(&mut value);
    value
}

#[test]
fn native_helper_costs_match_without_clone_or_early_drop() {
    let cases: [(fn(NoClone) -> NoClone, fn(NoClone) -> NoClone, usize, i32); 5] = [
        (borrowed, handwritten_borrowed, 1, 7),
        (repeated, handwritten_repeated, 2, 7),
        (transferred, handwritten_transferred, 0, 7),
        (mutated, handwritten_mutated, 1, 8),
        (constructed, handwritten_constructed, 0, 7),
    ];
    for (generated, native, expected_reads, expected_value) in cases {
        let reads = Rc::new(Cell::new(0));
        let drops = Rc::new(Cell::new(0));
        let actual = generated(NoClone::new(7, reads.clone(), drops.clone()));
        assert_eq!(actual.value(), expected_value);
        assert_eq!(reads.get(), expected_reads);
        assert_eq!(drops.get(), 0);
        assert_eq!(Rc::strong_count(&reads), 2);
        assert_eq!(Rc::strong_count(&drops), 2);
        drop(actual);
        assert_eq!(drops.get(), 1);
        let native_reads = Rc::new(Cell::new(0));
        let native_drops = Rc::new(Cell::new(0));
        let expected = native(NoClone::new(7, native_reads.clone(), native_drops.clone()));
        assert_eq!(expected.value(), expected_value);
        assert_eq!(reads.get(), native_reads.get());
        assert_eq!(native_drops.get(), 0);
        drop(expected);
        assert_eq!(drops.get(), native_drops.get());
    }
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["test", "--locked", "--offline", "--test", "borrowed"]);
});
