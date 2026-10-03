import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText, analyzeRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rustModuleBindingFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { planRustReferenceOperationCall } from "../../../dist/backend/planner/expressions/reference-operations.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

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
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /const separator: &str/u);
  assert.match(output, /fn rightParen\(value: &str\)/u);
  assert.match(output, /fn checkToken\(value: &str\)/u);
  assert.match(output, /fn dispatch\(kind: &str, payload: &str\)/u);
  assert.match(output, /fn retained\(value: String\)/u);
  assert.match(output, /borrow_number_element/u);
  assert.match(output, /sort_borrowed/u);
  assert.match(output, /fn ensureSlash\(value: String\) -> String/u);
  const ensure = output.slice(output.indexOf("fn ensureSlash"), output.indexOf("fn dispatch"));
  assert.doesNotMatch(ensure, /value\.clone\(\)/u);
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
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /sort_borrowed/u);
  assert.match(output, /get_number/u);
  validateGeneratedProject("native-retained-ownership", result.artifacts, { run: true });
});

test("local receiver field results do not force shared object storage", () => {
  for (const [body, expected] of [
    ["read(): number { return this.position; }", "value"],
    ["read(): Parser { return this; }", "shared-immutable"],
    ["read(): () => number { return () => this.position; }", "shared-immutable"],
  ]) {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
      class Parser { position = 0; ${body} }
      export function run(): void { const parser = new Parser(); parser.read(); }
    ` } });
    assert.equal(program.objectRepresentations.representations.find(value => value.definition.sourceName === "Parser")?.kind,
      expected, body);
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
` },
  });
  assert.deepEqual(result.diagnostics, []);
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
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /format!\("\{\}\{\}", first, second\)/u);
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
    const selected = program.facts.getFact(node, rustTargetOperationFactKey);
    if (selected?.kind === "reference-operation" && selected.operation === "load") { call = node; fact = selected; }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.source.sourceFiles.forEach(visit);
  assert.ok(call && fact);
  const operand = { kind: "path", path: "value" };
  const diagnostics = [];
  assert.deepEqual(planRustReferenceOperationCall(call, fact, { input: { program }, diagnostics }, () => operand),
    { kind: "owned-string-from-borrowed-str", expression: operand });
  assert.deepEqual(diagnostics, []);
  for (const invalid of [
    { ...fact, referenceCarrier: { ...fact.referenceCarrier, mutable: true } },
    { ...fact, resultCarrier: rustSourcePrimitiveTargetType("int32") },
  ]) {
    const rejected = [];
    assert.equal(planRustReferenceOperationCall(call, invalid, { input: { program }, diagnostics: rejected }, () => operand), undefined);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].message, /exact reference and result carrier/u);
  }
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
  assert.deepEqual(result.diagnostics, []);
  const root = writeGeneratedProject("shared-string-load-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), `${nativeOwnershipCostSupport}
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
        let (native_joined, native_joined_cost) = measure(|| format!("{}{}", input.as_str(), other.as_str()));
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
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
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
    assert.equal(program.facts.getFact(declaration, rustModuleBindingFactKey)?.storage, storage, source);
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

test("non-consuming comparisons preserve authored clone calls and their effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
let calls = 0;
class Counter { clone(): string { calls++; return "value"; } }
export function main(): void {
  const counter = new Counter();
  let matches = 0;
  if (counter.clone() !== undefined) matches++;
  if ((counter.clone()) === "value") matches++;
  if ((counter.clone() as string) !== undefined) matches++;
  if (matches !== 3 || calls !== 3) throw new Error("authored call was erased");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.equal([...output.matchAll(/counter\.clone\(\)/gu)].length, 3);
  validateGeneratedProject("authored-clone-effects", result.artifacts, { run: true });
});

test("borrow proofs respect retained callable ABIs through direct and indirect forwarding", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
const normalize = (value: string): string => value.replaceAll("x", "");
function width(value: string): number { return normalize(value).length; }
function direct(values: string[]): void { values.sort((left, right) => {
  const leftSize = normalize(left).length;
  const rightSize = normalize(right).length;
  return leftSize < rightSize ? -1 : leftSize > rightSize ? 1 : 0;
}); }
function indirect(values: string[]): void { values.sort((left, right) => width(left) - width(right)); }
export function main(): void {
  const first = ["bbb", "xa", "cc"];
  const second = ["xxxz", "yyy", "aa"];
  direct(first);
  indirect(second);
  if (first.join("|") !== "xa|cc|bbb" || second.join("|") !== "xxxz|aa|yyy")
    throw new Error("retained callable ABI");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /ModuleCell<NormalizeCallable>/u);
  assert.match(output, /fn width\(value: String\)/u);
  assert.doesNotMatch(output, /sort_borrowed/u);
  validateGeneratedProject("retained-callable-borrow-proof", result.artifacts, { run: true });
});

test("explicit shared String references borrow captured storage without copying", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { ref } from "@tsonic/rust/lang.js";
import type { Ref } from "@tsonic/rust/types.js";
import { read_to_string, write } from "@tsonic/rust/std/fs.js";
function writer(value: string): () => void {
  const path = "captured-reference.txt";
  return () => { write<Ref<string>, Ref<string>>(ref(path), ref(value)).unwrap(); };
}
export function main(): void {
  const output = writer("abc");
  output();
  output();
  if (read_to_string<string>("captured-reference.txt").unwrap() !== "abc")
    throw new Error("captured borrow");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /std::fs::write::<&str, &str>\(&capture_path, &capture_value\)/u);
  assert.doesNotMatch(output, /&capture_(?:path|value)\.clone\(\)/u);
  validateGeneratedProject("captured-string-reference", result.artifacts, { run: true });
});

test("value and retained cursor methods keep exact receiver lint contracts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
class LocalCursor {
  position = 0;
  next(): number { this.position++; return this.position; }
}
export class RetainedCursor {
  position = 0;
  next(): number { this.position++; return this.position; }
}
export function retain(): RetainedCursor { return new RetainedCursor(); }
export function main(): void {
  const local = new LocalCursor();
  const retained = retain();
  const alias = retained;
  if (local.next() !== 1 || local.next() !== 2 || retained.next() !== 1 || alias.next() !== 2)
    throw new Error("cursor receiver contract");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn next\(&mut self\)/u);
  assert.match(output, /fn next\(&self\)/u);
  validateGeneratedProject("cursor-receiver-lint-contract", result.artifacts, { run: true });
});
