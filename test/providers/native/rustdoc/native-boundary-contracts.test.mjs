import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { artifactText, compileRustThroughTargetPack, repositoryRoot } from "../../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";

test("native boxed errors preserve From conversion, Termination and the unboxed success path", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "bin", crateName: "native_boxed_errors" } },
    files: { "index.ts": `
import type { Dyn } from "@tsonic/rust/types.js";
import type { Box } from "@tsonic/rust/std/boxed.js";
import type { Error as NativeError } from "@tsonic/rust/std/error.js";
import { Result } from "@tsonic/rust/core/result.js";
import { read_to_string } from "@tsonic/rust/std/fs.js";
import { println } from "@tsonic/rust/std/index.js";
import { propagate } from "@tsonic/rust/lang.js";
type Outcome<T> = Result<T, Box<Dyn<NativeError>>>;
function read(path: string): Outcome<string> {
  return Result.Ok<string, Box<Dyn<NativeError>>>(propagate(read_to_string(path)));
}
export function main(): Outcome<void> {
  println("{}", propagate(read("fixture.txt")));
  return Result.Ok<void, Box<Dyn<NativeError>>>(undefined);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /Box<dyn (?:std|core)::error::Error>/u);
  assert.match(source, /read_to_string[^;]+\?/u);
  assert.doesNotMatch(source, /TsonicError|TsonicResult|Box::new|\.unwrap\(/u);
  assert.match(artifactText(result, "src/main.rs"), /Termination::report/u);
  const root = writeGeneratedProject("native-boxed-errors", result.artifacts);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["build", "--locked", "--offline"]);
  const binary = join(root, "target/debug/native_boxed_errors");
  const missing = spawnSync(binary, [], { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /Error:.*NotFound/u);
  assert.equal(missing.stdout, "");
  writeFileSync(join(root, "fixture.txt"), "native success");
  const success = spawnSync(binary, [], { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout, "native success\n");
  assert.equal(success.stderr, "");
});

test("native propagation leaves invalid error conversions to the exact native From contract", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Result } from "@tsonic/rust/core/result.js";
import { read_to_string } from "@tsonic/rust/std/fs.js";
import { propagate } from "@tsonic/rust/lang.js";
export function invalid(path: string): Result<string, int32> {
  return Result.Ok<string, int32>(propagate(read_to_string(path)));
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const root = writeGeneratedProject("native-invalid-error-conversion", result.artifacts);
  runCargo(root, ["generate-lockfile", "--offline"]);
  assert.throws(() => runCargo(root, ["check", "--locked", "--offline"]), /From<std::io::Error>.*not implemented for `i32`/su);
});

test("compiler-selected primitive namespaces preserve native widths, aliases and operations", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "native_primitive_apis" } },
    files: { "index.ts": `
import type { uint32, float32 } from "@tsonic/core/types.js";
import { u32 as unsigned, f32 } from "@tsonic/rust/core/index.js";
export function blocks(count: uint32, size: uint32): uint32 { return unsigned.div_ceil(count, size); }
export function magnitude(value: float32): float32 { return f32.abs(value); }
export function zero(): uint32 { return unsigned.default(); }
export function maximum(): uint32 { return unsigned.MAX; }
export function ordinary(value: float32): float32 {
  const f32 = { abs: (operand: float32): float32 => operand + 1 };
  return f32.abs(value);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /core::primitive::u32::div_ceil\(count, size\)/u);
  assert.match(source, /core::primitive::f32::abs\(value\)/u);
  assert.doesNotMatch(source, /f64|JsValue|as u32|as f32/u);
  const root = writeGeneratedProject("native-primitive-apis", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/primitive.rs"), `
use native_primitive_apis::index::{blocks, magnitude, maximum, ordinary, zero};
#[test]
fn exact_primitive_boundaries() {
    assert_eq!(zero(), u32::default());
    assert_eq!(maximum(), u32::MAX);
    for count in [0, 1, 255, 256, 257, u32::MAX] {
        for size in [1, 2, 256, u32::MAX] {
            assert_eq!(blocks(count, size), count.div_ceil(size));
        }
    }
    assert!(std::panic::catch_unwind(|| blocks(1, 0)).is_err());
    for value in [-0.0, 0.0, -1.5, f32::INFINITY, f32::NEG_INFINITY, f32::NAN] {
        assert_eq!(magnitude(value).to_bits(), value.abs().to_bits());
    }
    assert_eq!(ordinary(3.0).unwrap(), 4.0);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--locked", "--offline"]);
  assert.throws(() => compileRustThroughTargetPack({ files: { "index.ts": `
import { u32 } from "@tsonic/rust/core/index.js";
export function invalid(): void { u32.div_ceil("not an integer", 2); }
` } }), /not assignable/u);
});

test("native optional exclusive references mutate their original backing without a location wrapper", { timeout: 300_000 }, () => {
  const project = createBorrowedProject();
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", projectFile: project.manifestPath } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life } from "@tsonic/rust/types.js";
import { load, store } from "@tsonic/rust/lang.js";
import type { BorrowedBuffer, DomainIndex } from "@tsonic/rust/crates/borrowed/index.js";
export function write<L extends Life>(buffer: BorrowedBuffer<L>, index: DomainIndex, value: int32): boolean {
  const selected = buffer.get_mut(index);
  if (selected === undefined) return false;
  store(selected, value - 1);
  store(selected, load(selected) + 1);
  return true;
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /Option<&mut i32>/u);
  assert.doesNotMatch(source, /Rc|RefCell|Location|\.clone\(|Box::/u);
  writeArtifacts(project.root, result.artifacts);
  mkdirSync(join(project.root, "tests"), { recursive: true });
  writeFileSync(join(project.root, "tests/backing.rs"), `
use borrowed::{BorrowedBuffer, DomainIndex};
#[test]
fn mutation_reaches_the_original_storage() {
    let mut values = [3, 4];
    assert!(borrowed_contract::index::write(BorrowedBuffer::new(&mut values), DomainIndex::new(1), 9));
    assert_eq!(values, [3, 9]);
    assert!(!borrowed_contract::index::write(BorrowedBuffer::new(&mut values), DomainIndex::new(3), 12));
    assert_eq!(values, [3, 9]);
}
`);
  runCargo(project.root, ["generate-lockfile", "--offline"]);
  runCargo(project.root, ["test", "--locked", "--offline"]);
  assert.throws(() => compileRustThroughTargetPack({
    target: { id: "rust", options: { projectFile: project.manifestPath } },
    files: { "index.ts": `
import type { Life } from "@tsonic/rust/types.js";
import type { BorrowedBuffer } from "@tsonic/rust/crates/borrowed/index.js";
export function invalid<L extends Life>(buffer: BorrowedBuffer<L>): void { buffer.get_mut(0); }
` },
  }), /not assignable/u);
});

test("native borrowed results cannot escape into a static lifetime", { timeout: 300_000 }, () => {
  const project = createBorrowedProject();
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", projectFile: project.manifestPath } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Mut, Static } from "@tsonic/rust/types.js";
import type { BorrowedBuffer, DomainIndex } from "@tsonic/rust/crates/borrowed/index.js";
export function escape<L extends Life>(buffer: BorrowedBuffer<L>, index: DomainIndex): Mut<int32, Static> | undefined {
  return buffer.get_mut(index);
}
` },
  });
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["RUST_RETURN_CARRIER_MISMATCH"]);
  assert.deepEqual(result.artifacts, []);
});

function createBorrowedProject() {
  const root = createTestWorkspace(resolve(repositoryRoot, ".temp/native-boundary"), "borrowed-");
  const manifestPath = join(root, "Cargo.toml");
  writeFileSync(manifestPath, `[package]
name = "borrowed-contract"
version = "0.0.0"
edition = "2024"
[lib]
path = "generated/src/lib.rs"
[dependencies]
borrowed = { package = "acme-borrowed", path = ${JSON.stringify(resolve(repositoryRoot, "test/fixtures/crates/acme_borrowed"))} }
tsonic_rust_runtime = { path = ${JSON.stringify(resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime"))} }
`);
  mkdirSync(join(root, "generated/src"), { recursive: true });
  writeFileSync(join(root, "generated/src/lib.rs"), "");
  return { root, manifestPath };
}

function writeArtifacts(root, artifacts) {
  for (const artifact of artifacts) {
    const file = join(root, "generated", artifact.path);
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, artifact.text);
  }
}
