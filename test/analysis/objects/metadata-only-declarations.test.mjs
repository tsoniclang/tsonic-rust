import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";

const pureSource = `
import type { char, float16, float32, int64, uint8 } from "@tsonic/core/types.js";
const nativeKey = "value";
interface Holder { [nativeKey]: number; }
const literalKey = "literal";
type Literal = { [literalKey]: number };
const numericMetadata = 7;
type Numeric = typeof numericMetadata;
const booleanMetadata = true;
type BooleanMetadata = typeof booleanMetadata;
const templateMetadata = \`template\`;
type Template = typeof templateMetadata;
const wrappedMetadata = ("wrapped" as const);
type Wrapped = typeof wrappedMetadata;
const astralMetadata = "🌿";
type Astral = typeof astralMetadata;
const narrowMetadata: uint8 = 7;
type Narrow = typeof narrowMetadata;
const wideMetadata: int64 = 9007199254740993n;
type Wide = typeof wideMetadata;
const fractionalMetadata: float32 = 1.0000000596046448;
type Fractional = typeof fractionalMetadata;
const negativeMetadata: float32 = -1.5;
type Negative = typeof negativeMetadata;
const halfMetadata: float16 = 1.5;
type Half = typeof halfMetadata;
const charMetadata: char = "é";
type Character = typeof charMetadata;
const shadowMetadata = "outer";
type Shadow = typeof shadowMetadata;
function nativeShadow(): string { const shadowMetadata = "inner"; return shadowMetadata; }
function exactKey(): number {
  const { key } = { key: "value" } as const;
  const value: Holder = { [key]: 23 };
  return value[key];
}
export function run(): boolean { return exactKey() === 23 && nativeShadow() === "inner"; }
`;

const retainedSource = `
let sequence = 0;
function makeKey(): "call" { sequence = sequence * 10 + 1; return "call"; }
class KeySource { get key(): "getter" { sequence = sequence * 10 + 2; return "getter"; } }
class OwnedGuard { constructor() { sequence = sequence * 10 + 3; } }
const callKey = makeKey();
interface CallShape { [callKey]: number; }
const getterKey = new KeySource().key;
interface GetterShape { [getterKey]: number; }
const ownedGuard = new OwnedGuard();
type GuardMetadata = typeof ownedGuard;
const arrayMetadata = [1, 2];
type ArrayMetadata = typeof arrayMetadata;
const runtimeKey = "runtime";
interface RuntimeShape { [runtimeKey]: number; }
export const exportedKey = "exported";
interface ExportedShape { [exportedKey]: number; }
let mutableMetadata = 7;
type Mutable = typeof mutableMetadata;
export function run(): boolean {
  const value: RuntimeShape = { runtime: 29 };
  mutableMetadata = 8;
  return value[runtimeKey] === 29 && exportedKey === "exported" && sequence === 123 && mutableMetadata === 8;
}
`;

function namedVariable(program, name, moduleLevel = true) {
  const { ast } = program.source;
  const pending = [...program.sourceFiles];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (ast.is.IsVariableDeclaration(node) && ast.is.IsIdentifier(ast.name(node)) && ast.text(ast.name(node)) === name &&
      sourceDeclarationIsModuleScoped(node, ast) === moduleLevel) return node;
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  assert.fail(`missing actual checked variable ${name}`);
}

function compile(sourceText, surfaces) {
  return compileRust({ surfaces, files: { "index.ts": sourceText },
    target: { id: "rust", options: { outputType: "bin", crateName: "metadata_only_declarations" } } });
}

function successful(compiled, label) {
  assert.equal(compiled.result.diagnostics.length, 0,
    `${label}: ${compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048)}`);
  assert.equal(compiled.result.program !== undefined && compiled.result.plan !== undefined, true, `${label}: genuine sealed native program`);
  return compiled.result.program;
}

const nativeCounterpart = `
struct NativeHolder {
    value: f64,
}

fn native_run() -> bool {
    let key = "value";
    let value = NativeHolder { value: 23.0 };
    std::hint::black_box(key);
    value.value == 23.0
}

#[test]
fn metadata_only_native_counterpart() {
    assert!(native_run());
}
`;

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`Rust ${surface} admits the whole pure metadata constant class before erasure`, { timeout: 300_000 }, () => {
    const compiled = compile(`${pureSource}\nif (!run()) throw new Error("metadata native counterpart");`, surfaces);
    const program = successful(compiled, surface);
    for (const name of ["nativeKey", "literalKey", "numericMetadata", "booleanMetadata", "templateMetadata", "wrappedMetadata", "astralMetadata",
      "narrowMetadata", "wideMetadata", "fractionalMetadata", "negativeMetadata", "halfMetadata", "charMetadata", "shadowMetadata"]) {
      const declaration = namedVariable(program, name);
      assert.equal(program.records.compileTimeSource.get(declaration), true, `${name}: existing native erasure fact`);
      assert.equal(program.sourceNavigation.declarationUseSummary(declaration).uses.every(use => use.kind === "type-only"), true,
        `${name}: the actual checked declaration has only erased references`);
    }
    const output = artifactText(compiled.result, "src/index.rs");
    const wideInitializer = program.source.ast.as.AsVariableDeclaration(namedVariable(program, "wideMetadata"))?.Initializer;
    assert.equal(wideInitializer !== undefined && program.records.literalValue.get(wideInitializer)?.integer === 9007199254740993n, true,
      "erasure preserves exact native integer metadata beyond the JS Number domain");
    const floatInitializer = program.source.ast.as.AsVariableDeclaration(namedVariable(program, "fractionalMetadata"))?.Initializer;
    const numeric = floatInitializer === undefined ? undefined : program.records.literalValue.get(floatInitializer)?.numeric;
    assert.equal(numeric?.kind === "authored" && numeric.token.decimalText === "1.0000000596046448", true,
      "the canonical authored native float token remains unchanged");
    for (const name of ["nativeKey", "literalKey", "numericMetadata", "booleanMetadata", "templateMetadata", "wrappedMetadata", "astralMetadata",
      "narrowMetadata", "wideMetadata", "fractionalMetadata", "negativeMetadata", "halfMetadata", "charMetadata"]) {
      assert.equal(new RegExp(`\\b${name}\\b`, "u").test(output), false, `${name}: no native cell, constant, helper or lint workaround`);
    }
    assert.equal(program.records.compileTimeSource.get(namedVariable(program, "shadowMetadata", false)) !== true, true,
      "an identically spelled local runtime binding is not selected for metadata erasure");
    validateGeneratedProject(`metadata-only-declarations-${surface}`, [...compiled.result.artifacts,
      { path: "tests/native_metadata_counterpart.rs", text: nativeCounterpart.trimStart() }], { run: true });
  });

  test(`Rust ${surface} retains effects, runtime access, exports, writes and owned native state`, { timeout: 300_000 }, () => {
    const compiled = compile(`${retainedSource}\nif (!run()) throw new Error("metadata initializer order");`, surfaces);
    const program = successful(compiled, surface);
    for (const name of ["callKey", "getterKey", "ownedGuard", "arrayMetadata", "runtimeKey", "exportedKey", "mutableMetadata"]) {
      assert.equal(program.records.compileTimeSource.get(namedVariable(program, name)) !== true, true,
        `${name}: source-only use is not native construction/purity/lifetime permission`);
    }
    validateGeneratedProject(`metadata-only-retained-${surface}`, compiled.result.artifacts, { run: true });
  });

  for (const [name, token] of [["narrow", "256"], ["fractional", "1.5"]]) {
    test(`Rust ${surface} metadata-only ${name} initializer retains native uint8 rejection`, () => {
      const compiled = compile(`import type { uint8 } from "@tsonic/core/types.js";
const invalid: uint8 = ${token}; type Metadata = typeof invalid; export function run(): boolean { return true; }`, surfaces);
      assert.equal(compiled.result.diagnostics.some(issue => issue.category === "error"), true, "invalid native construction is not erased");
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "rejection remains before publication");
      assert.equal(compiled.result.artifacts.length, 0, "no native output hides the invalid metadata initializer");
    });
  }

  for (const [kind, initializer] of [["float16", "65520"], ["char", '"ab"']]) {
    test(`Rust ${surface} metadata-only ${kind} preserves canonical native literal admission`, () => {
      const compiled = compile(`import type { ${kind} } from "@tsonic/core/types.js";
const invalid: ${kind} = ${initializer}; type Metadata = typeof invalid; export function run(): boolean { return true; }`, surfaces);
      assert.equal(compiled.result.diagnostics.some(issue => issue.category === "error"), true, `${kind}: native literal rejection is not suppressed`);
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, `${kind}: no publication`);
      assert.equal(compiled.result.artifacts.length, 0, `${kind}: no artifacts`);
    });
  }

  test(`Rust ${surface} runtime reads before initialization retain their source rejection`, () => {
    assert.throws(() => compile('const early = key; const key = "value"; interface Metadata { [key]: number; } export function run(): boolean { return early === "value"; }', surfaces),
      error => error instanceof Error && error.message.includes("error TS2448:") && error.message.includes("error TS2454:"),
      "the actual checked-source boundary refuses the unchanged TDZ source before a native result can be returned");
  });

  test(`Rust ${surface} an unrelated runtime module cycle is not erased with metadata`, () => {
    const compiled = compileRust({ surfaces, files: {
      "index.ts": 'import { read } from "./other.js"; const key = "value"; interface Metadata { [key]: number; } export const value: number = read(); export function run(): number { return value; }',
      "other.ts": 'import { value } from "./index.js"; export function read(): number { return value + 1; }',
    } });
    assert.equal(compiled.result.diagnostics.some(issue => /cycl/iu.test(issue.message)), true, "the existing runtime-cycle owner still refuses the actual cycle");
    assert.equal(compiled.result.program === undefined && compiled.result.artifacts.length === 0, true, "cycle rejection remains before publication");
  });

  test(`Rust ${surface} absent uses are not a new generic dead-declaration pass`, () => {
    const compiled = compile('const unused = "value"; export function run(): boolean { return true; }', surfaces);
    const program = successful(compiled, surface);
    assert.equal(program.records.compileTimeSource.get(namedVariable(program, "unused")) !== true, true,
      "unused-declaration removal is not inferred from an empty type-use set");
  });

  test(`Rust ${surface} unproved scalar string encoding stays on its original native path`, () => {
    const compiled = compile('const unproved = "\\uD800"; type Metadata = typeof unproved; export function run(): boolean { return true; }', surfaces);
    const program = successful(compiled, surface);
    assert.equal(program.records.compileTimeSource.get(namedVariable(program, "unproved")) !== true, true,
      "erasure never hides an unproved native string literal; no new source restriction is introduced");
  });
}
