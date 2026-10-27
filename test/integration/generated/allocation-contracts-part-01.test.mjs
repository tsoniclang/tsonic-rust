import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import { assertRustRecordRequirement } from "../../helpers/required-records.mjs";
import test from "node:test";
import { nativeFunction, nativeSource, nativeType, nativeBorrow, nativeMethods,
  assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { capturedStringOwnershipSource } from "../../../../tsonic/test/fixtures/captured-string-ownership.mjs";
import { compileRust, artifactText, analyzeRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planRustReferenceOperationCall } from "../../../dist/backend/planner/expressions/reference-operations.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustReferenceOperations } from "../../../dist/analysis/operations/reference-operations.js";
import { createRustReferenceOperationProducer } from "../../../dist/analysis/program/records/operations/reference-operations.js";

test("owned exits, static text, direct helpers and scoped array reads execute without extra owners", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
const separator = "/";
function checkToken(value: string): boolean { return rightParen(value); }
const rightParen = (value: string): boolean => value === ")";
function ensureSlash(value: string): string { return value.endsWith("/") ? value : value + "/"; }
function dispatch(kind: string, payload: string): number { return kind === "size" ? payload.length : 0; }
function retained(value: string): () => string { return () => value; }
let calls = 0;
function append(values: string[]): number { calls++; values.push("tail"); return values.length - 1; }
export function main(): void {
  const values = ["café", "a", "😀"];
  const size = values[append(values)]!.length;
  values.sort((left, right) => left.length < right.length ? -1 : left.length > right.length ? 1 : 0);
  if (size !== 4 || calls !== 1 || values[0] !== "a" || !checkToken(")") ||
    ensureSlash("ok/") !== "ok/" || ensureSlash("ok") !== "ok/" ||
    dispatch("size", "café😀") !== 9 || retained("kept")() !== "kept" || separator !== "/") {
    throw new Error("allocation contract");
  }
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const model = nativeSource(result);
  const separator = model.items.filter(item => item.kind === "const" && item.name === "separator");
  assert.equal(separator.length, 1);
  assert.deepEqual(separator[0].type, nativeBorrow(nativeType("str")));
  for (const name of ["rightParen", "checkToken"]) {
    assert.deepEqual(nativeFunction(result, name).params.map(parameter => parameter.type), [nativeBorrow(nativeType("str"))]);
  }
  assert.deepEqual(nativeFunction(result, "dispatch").params.map(parameter => parameter.type),
    [nativeBorrow(nativeType("str")), nativeBorrow(nativeType("str"))]);
  assert.deepEqual(nativeFunction(result, "retained").params.map(parameter => parameter.type), [nativeType("String")]);
  assert.equal(nativeMethods(model, "borrow_number_element").length, 1);
  assert.equal(nativeMethods(model, "sort_borrowed").length, 1);
  const ensure = nativeFunction(result, "ensureSlash");
  assert.deepEqual(ensure.params.map(parameter => parameter.type), [nativeType("String")]);
  assert.deepEqual(ensure.returnType, nativeType("String"));
  assertNoNativeCalls(ensure.body, ["clone"], "owned exits do not copy the input");
  validateGeneratedProject("native-allocation-contracts", result.artifacts, { run: true });
});

test("ownership proof keeps loop, finalizer, retained-comparator and alias semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
let observed = "";
function finalize(value: string): string { try { return value; } finally { observed = value; } }
function repeat(value: string): string { let text = ""; for (let index = 0; index < 2; index++) text += value; return text; }
export function main(): void {
  const values = ["bb", "a"];
  const saved = values[0]!;
  values[0] = "changed";
  values.sort((left, right) => { observed = left; return left.length < right.length ? -1 : left.length > right.length ? 1 : 0; });
  if (saved !== "bb" || repeat(saved) !== "bbbb" || finalize(saved) !== "bb" || observed !== "bb")
    throw new Error("ownership was erased");
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /sort_borrowed/u);
  assert.match(output, /get_number/u);
  validateGeneratedProject("native-retained-ownership", result.artifacts, { run: true });
});

test("local receiver field results do not force shared object storage", () => {
  for (const [body, expected, fieldOnly] of [
    ["read(): number { return this.position; }", "value", false],
    ["read(): Parser { return this; }", "shared-immutable", false],
    ["read(): () => number { return () => this.position; }", "value", true],
  ]) {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": `
      class Parser { position = 0; ${body} }
      export function run(): void { const parser = new Parser(); parser.read(); }
    ` } });
    const representation = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Parser");
    assert.equal(representation !== undefined, true, "exact selected Parser representation");
    assert.equal(representation.kind, expected, body);
    const ast = program.source.ast;
    const members = ast.members(representation.definition.declaration).filter(member => member !== undefined);
    const method = members.find(member => ast.text(ast.name(member)) === "read");
    assert.equal(method !== undefined, true, "exact selected read method");
    const methodBody = ast.body(method);
    assert.equal(methodBody !== undefined, true, "checked read method body");
    const callable = Node_Expression(ast, ast.statements(methodBody)[0]);
    assert.equal(callable !== undefined, true, "checked read return value");
    assert.equal(ast.is.IsArrowFunction(callable), fieldOnly, "exact expected field-only closure input");
    if (fieldOnly) {
      const field = members.find(member => ast.text(ast.name(member)) === "position");
      assertRustRecordRequirement(requiredRecords, "capturedFieldStorage", field);
      assert.equal(field !== undefined, true, "exact selected position field");
      const captures = program.objectRepresentations.receiverCaptures.capturesFor(callable);
      assert.equal(captures.length, 1, "one retained field, not the whole object");
      assert.equal(captures[0].declaration === field, true, "capture retains the checked position declaration");
      assert.equal(captures[0].references.length, 1, "one checked position read");
      assert.equal(program.objectRepresentations.receiverCaptures.receiversFor(callable).length, 0,
        "field-only closure has no whole receiver owner");
      const storage = program.records.capturedFieldStorage.get(field);
      assert.equal(storage !== undefined, true, "sealed live field storage");
      assert.equal(storage.storage.kind, "cell", "mutable field retains its native Cell owner");
      assert.equal(storage.storage.initialization, "ready", "field initializer precedes retention");
    }
  }
});

test("last-use moves respect overlapping argument borrows without penalizing completed reads", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
function select(first: string, second: string): string { return first.length === 0 ? "empty" : second; }
function identity(value: string): string { return value; }
function length(value: string): number { return value.length; }
function afterLength(size: number, value: string): string { return size === 0 ? "empty" : value; }
function owned(first: string, second: string): string[] { return [first, second]; }
export function main(): void {
  const direct = "direct";
  const directResult = select((direct), direct);
  const nested = "nested";
  const nestedResult = select(nested, identity(nested));
  const completed = "completed";
  const completedResult = afterLength(length(completed), completed);
  const copies = "copies";
  const ownedResult = owned(copies, copies);
  if (directResult !== "direct" || nestedResult !== "nested" || completedResult !== "completed" ||
      ownedResult[0] !== "copies" || ownedResult[1] !== "copies") throw new Error("argument ownership");
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /select\(&direct, direct\.clone\(\)\)/u);
  assert.match(output, /select\(&nested, identity\(nested\.clone\(\)\)\)/u);
  assert.match(output, /afterLength\(length\(&completed\), completed\)/u);
  assert.match(output, /owned\(copies\.clone\(\), copies\)/u);
  validateGeneratedProject("overlapping-argument-borrows", result.artifacts, { run: true });
});

test("nested native reference arguments retain their borrowed source through consumption", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
function borrowed<Region extends Life>(value: Ref<string, Region>): Ref<string, Region> { return value; }
function combined<Region extends Life>(first: Ref<string, Region>, second: string): string { return load(first) + second; }
function copied<Region extends Life>(value: Ref<string, Region>): string { return load(value); }
function empty<Region extends Life>(value: Ref<string, Region>): string { return load(value) + ""; }
function observed<Region extends Life>(value: Ref<string, Region>): boolean { return load(value).length === 8 && load(value) === "borrowed"; }
export function main(): void {
  const value = "borrowed";
  if (copied(ref(value)) !== "borrowed" || empty(ref(value)) !== "borrowed" || !observed(ref(value)) ||
      combined(borrowed(ref(value)), value) !== "borrowedborrowed") throw new Error("nested native reference");
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /\.concat\(\)/u);
  assert.doesNotMatch(output, /format!|first\.clone\(\)/u);
  assert.match(output, /combined\(borrowed\(&value\), value\.clone\(\)\)/u);
  assert.match(output, /fn copied[\s\S]*?String::from\(value\)/u);
  assert.match(output, /fn empty[\s\S]*?String::from\(value\)/u);
  validateGeneratedProject("nested-reference-consumption", result.artifacts, { run: true });
});

test("shared string load planning requires its exact sealed reference and value carrier", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function read(value: Ref<string>): string { return load(value); }
` } });
  const { ast } = program.source;
  let call;
  let fact;
  const visit = node => {
    const selected = program.records.targetOperation.get(node);
    if (selected?.kind === "reference-operation" && selected.operation === "load") { call = node; fact = selected; }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.source.sourceFiles.forEach(visit);
  assert.ok(call && fact);
  const operand = { kind: "path", path: "value" };
  const diagnostics = [];
  assert.deepEqual(planRustReferenceOperationCall(call, fact, { input: { program }, diagnostics }, () => operand),
    { kind: "owned-string-from-borrowed-str", expression: operand });
  assertNoTargetDiagnostics(diagnostics);
  for (const invalid of [
    { ...fact, referenceCarrier: { ...fact.referenceCarrier, mutable: true } },
    { ...fact, resultCarrier: rustSourcePrimitiveTargetType("int32") },
  ]) {
    const records = createRustRecordFixture({ targetOperation: { get: subject => subject === call
      ? invalid : program.records.targetOperation.get(subject) } }, program.records);
    const producer = createRustReferenceOperationProducer(() => {});
    const rejected = analyzeRustReferenceOperations({ ...program, records }, [call], producer);
    assert.equal(rejected.length, 1, "each original reference/result conflict is rejected before final publication");
    assert.equal(rejected[0].code, "RUST_MISSING_TARGET_FACT");
    assert.equal(rejected[0].sourceNode === call, true, "the actual checked load owns its original refusal");
    assert.equal(rejected[0].message, "Rust reference load conflicts with its exact reference and result carrier relationship. Node kind: KindCallExpression.");
    assert.deepEqual(rejected[0].evidence, ["target.capability=RUST_REFERENCE_LOAD_VALUE_CONFLICT"]);
    assert.equal(producer.records.referenceOperation.get(call) === undefined, true,
      "neither original negative admits a final native reference operation");
    const unchanged = [];
    assert.deepEqual(planRustReferenceOperationCall(call, invalid, { input: { program }, diagnostics: unchanged }, () => operand),
      { kind: "owned-string-from-borrowed-str", expression: operand },
      "post-seal source tampering cannot reselect the immutable native load");
    assertNoTargetDiagnostics(unchanged);
  }
  const records = createRustRecordFixture({ referenceOperation: { get: () => undefined } }, program.records);
  assert.throws(() => planRustReferenceOperationCall(call, fact, { input: { program: { ...program, records } }, diagnostics: [] }, () => operand),
    error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.message === "An admitted reference operation requires its exact native operand and storage plan.",
    "the renderer cannot recreate a missing required final native load from old source facts");
});

test("shared string load ownership and borrowed observations match native allocations", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: {
    outputType: "lib", crateName: "shared_string_load_cost",
  } }, files: { "index.ts": `
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function copied<Region extends Life>(value: Ref<string, Region>): string { return load(value); }
export function empty<Region extends Life>(value: Ref<string, Region>): string { return load(value) + ""; }
export function joined<Region extends Life>(left: Ref<string, Region>, right: Ref<string, Region>): string { return load(left) + load(right); }
export function observed<Region extends Life>(value: Ref<string, Region>): boolean { return load(value).length > 0; }
export function equal<Region extends Life>(left: Ref<string, Region>, right: Ref<string, Region>): boolean { return load(left) === load(right); }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const root = writeGeneratedProject("shared-string-load-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), `${nativeOwnershipCostSupport(root)}
use shared_string_load_cost::index;

#[test]
fn owned_results_and_borrowed_observations_match_handwritten_costs() {
    let input = String::from("café😀 native read");
    let other = String::from("other text");
    for _ in 0..10_000 {
        for copied in [index::copied, index::empty] {
            let (generated, generated_cost) = measure(|| copied(input.as_str()));
            let (native, native_cost) = measure(|| String::from(input.as_str()));
            assert_eq!(generated, native);
            assert_eq!(generated_cost, native_cost);
        }
        let (joined, joined_cost) = measure(|| index::joined(input.as_str(), other.as_str()));
        let (native_joined, native_joined_cost) = measure(|| {
            let mut output = String::with_capacity(input.len() + other.len());
            output.push_str(input.as_str());
            output.push_str(other.as_str());
            output
        });
        assert_eq!(joined, native_joined);
        assert_eq!(joined_cost, native_joined_cost);
        let (observations, observation_cost) = measure(|| (
            index::observed(input.as_str()), index::equal(input.as_str(), input.as_str()),
            index::equal(input.as_str(), other.as_str()), index::observed(""),
        ));
        assert_eq!(observations, (true, true, false, false));
        assert_eq!(observation_cost, Cost::default());
    }
    assert_eq!(input, "café😀 native read");
    assert_eq!(other, "other text");
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt"]);
  runCargo(root, ["fmt", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
});

test("terminal owned string captures match handwritten shared closure frame and invocation costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: {
    outputType: "lib", crateName: "terminal_capture_cost",
  } }, files: { "index.ts": `
export function retained(value: string): () => string { return () => value; }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /let capture_value = value;/u);
  assert.doesNotMatch(output, /let capture_value = value\.clone\(\)/u);
  const root = writeGeneratedProject("terminal-capture-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), `${nativeOwnershipCostSupport(root)}
use terminal_capture_cost::index;
use tsonic_rust_runtime as rt;

fn handwritten(value: String) -> rt::Callable<'static, (), rt::TsonicResult<String>> {
    rt::Callable::new(move |()| Ok(value.clone()))
}

#[test]
fn owned_capture_and_repeated_reads_match_handwritten_costs() {
    for _ in 0..64 {
        let generated_input = String::from("café😀 owned capture");
        let native_input = generated_input.clone();
        let (generated, generated_cost) = measure(|| index::retained(generated_input));
        let (native, native_cost) = measure(|| handwritten(native_input));
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        assert_eq!(generated_cost.reallocations, 0);
        for _ in 0..16 {
            let (actual, actual_cost) = measure(|| generated.call(()).unwrap());
            let (expected, expected_cost) = measure(|| native.call(()).unwrap());
            assert_eq!(actual, expected);
            assert_eq!(actual_cost, expected_cost);
        }
    }
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt"]);
  runCargo(root, ["fmt", "--check"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
});

test("pure captured string append matches handwritten mutable storage costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: {
    outputType: "lib", crateName: "captured_append_cost",
  } }, files: { "index.ts": capturedStringOwnershipSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /borrow_mut\(\)\.push\('!'\)/u);
  const root = writeGeneratedProject("captured-append-cost", result.artifacts);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--", "--check"]);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), `${nativeOwnershipCostSupport(root)}
use captured_append_cost::index;
use std::cell::RefCell;
use tsonic_rust_runtime as rt;

fn handwritten(value: String) -> rt::Callable<'static, (), rt::TsonicResult<f64>> {
    let value = RefCell::new(value);
    rt::Callable::new(move |()| {
        value.borrow_mut().push('!');
        Ok(value.borrow().encode_utf16().count() as f64)
    })
}

#[test]
fn exact_mutable_frame_and_append_costs() {
    for _ in 0..32 {
        let input = String::with_capacity(1024);
        let native_input = String::with_capacity(1024);
        let (generated, generated_cost) = measure(|| index::append(input));
        let (native, native_cost) = measure(|| handwritten(native_input));
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        for index in 1..=1024 {
            let (generated_result, generated_cost) = measure(|| generated.call(()).unwrap());
            let (native_result, native_cost) = measure(|| native.call(()).unwrap());
            assert_eq!(generated_result, f64::from(index));
            assert_eq!(generated_result, native_result);
            assert_eq!(generated_cost, native_cost);
            assert_eq!(generated_cost.allocations, 0);
        }
    }
    let repeated = index::duplicate(String::from("x"));
    assert_eq!(repeated.call(()).unwrap(), "xx");
    assert_eq!(repeated.call(()).unwrap(), "xxxx");
    let observed = index::observed(String::from("before"));
    assert_eq!(observed.call(()).unwrap(), "before!");
    assert_eq!(observed.call(()).unwrap(), "before!!");
}
`);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "ownership"]);
});

test("static string selection preserves exported bindings and deferred default reads", () => {
  for (const [source, storage] of [
    ['const value = "ready"; export function read(): string { return value; }', "native-const"],
    ['export const value = "public";', "module-cell"],
    ['import { addressof, loadptr } from "@tsonic/core/lang.js"; let value = "ready"; export function read(): string { return loadptr(addressof(value)); }', "module-cell"],
    ['export const result = read(); const value = "later"; function read(input: string = value): string { return input; }', "module-cell"],
    ['const value = "ready"; export const result = read(); function read(input: string = value): string { return input; }', "native-const"],
  ]) {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
    const ast = program.source.ast;
    let declaration;
    const visit = node => {
      if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "value") declaration = node;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.notEqual(declaration, undefined);
    assert.equal(program.records.moduleBinding.get(declaration)?.storage, storage, source);
  }
  assert.throws(() => analyzeRust({ surfaces: ["js"], files: { "index.ts":
    'import { addressof } from "@tsonic/core/lang.js"; const value = "ready"; export const pointer = addressof(value);',
  } }), /addressof\(\.\.\.\) requires writable storage/u);
});

test("address-of rejects imported constants before target planning", () => {
  for (const module of ["values", "exports"]) {
    assert.throws(() => analyzeRust({ surfaces: ["js"], files: {
      "values.ts": `export const fixed = 7;`,
      "exports.ts": `export { fixed } from "./values.js";`,
      "index.ts": `import { addressof } from "@tsonic/core/lang.js";
        import { fixed } from "./${module}.js";
        export function reject(): void { addressof(fixed); }`,
    } }), /addressof\(\.\.\.\) requires writable storage/u);
  }
});
