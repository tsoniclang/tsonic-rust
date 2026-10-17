import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { prepareRustReadOwnership, analyzeRustReadOwnership } from "../../../dist/analysis/ownership/reads.js";
import { analyzeRustReadUses } from "../../../dist/analysis/ownership/uses.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/operations/finalized-operation/finalize.js";
import { planRustFinalizedOperationForm } from "../../../dist/backend/planner/expressions/finalized-operation-form.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustStringTargetType, rustBorrowedStrTargetType, rustNamedTargetType } from "../../../dist/target-model/types/index.js";
import { rustStringToBorrowedStrValueConversion, rustBorrowedStrToStringValueConversion } from "../../../dist/public/provider.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { nativeFunction, nativeMethods } from "../../helpers/native-ast.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const string = rustStringTargetType();
const integer = { kind: "source-primitive", name: "int32" };
const owner = rustNamedTargetType("fixture.Owner", "fixture::Owner");
const noClone = rustNamedTargetType("fixture.NoClone", "fixture::NoClone");

async function fixture({ form = "field", carrier = string, conversion, borrowed = false, union = false } = {}) {
  const source = createTargetSourceProgram(await checkedSource("provider-result-read", {
    "src/index.ts": `interface Holder { value: string; [key: number]: string }
declare function observe(value: string): number;
function read(holder: Holder): unknown { return observe(${form === "index" ? "holder[0]" : "holder.value"}); }`,
  }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const nodes = new Set(storage.nodes);
  const node = storage.nodes.find(candidate => form === "index" ? source.ast.is.IsElementAccessExpression(candidate)
    : source.ast.is.IsPropertyAccessExpression(candidate));
  const call = source.ast.parent(node);
  assert.equal(node !== undefined && source.ast.is.IsCallExpression(call), true, "the source supplies the exact original input");
  const abi = finalizeRustProviderOperationAbi({ operationKind: form === "field" ? "property" : "indexer",
    form: form === "field" ? { form, name: "value" } : { form }, sourceReceiver: { kind: "runtime", carrier: owner },
    sourceArgumentCarriers: form === "field" ? [] : [integer], resultCarrier: carrier,
    ...(conversion === undefined ? {} : { resultConversion: conversion }), isAsync: false, isFallible: false });
  assert.equal(abi !== undefined, true, "the actual native operation finalizer admits the complete ABI");
  const operation = { kind: "provider-operation", operationId: "fixture.read", resultCarrier: abi.result.carrier, abi };
  const other = union ? { ...operation, operationId: "fixture.other", abi: Object.freeze({ ...abi }) } : undefined;
  const observed = borrowed ? finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "call", path: "fixture::observe", argModes: ["ref"] }, sourceArgumentCarriers: [carrier],
    resultCarrier: integer, isAsync: false, isFallible: false }) : undefined;
  assert.equal(!borrowed || observed !== undefined, true, "the outer borrowed input has its own exact selected ABI");
  const records = createRustRecordFixture({ targetOperation: { get: candidate => candidate === node
    ? other === undefined ? operation : { kind: "union-property", operationId: "fixture.union",
      resultCarrier: carrier, variants: [{ name: "First", operation }, { name: "Second", operation: other }],
      selectedVariantIndexes: [0, 1] }
    : candidate === call && observed !== undefined ? { kind: "provider-operation", operationId: "fixture.observe", abi: observed }
      : undefined }, runtimeCarrier: { get: candidate => candidate === node ? { carrier } : undefined } });
  const effects = { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() };
  const input = { storage, nativeNodes: storage.nodes, records,
    flow: { readTransfers: new Map(), captureRequirements: new Map(), captureTransfers: new Map(), graphs: new Map(), liveness: new Map() },
    borrowEffects: effects, borrowEffectsInput: { ast: source.ast, records, navigation: source.navigation,
      readUses: analyzeRustReadUses(source.ast, storage.nodes, records),
      isNativeNode: candidate => nodes.has(candidate) },
    definitions: emptyRustTypeDefinitions, genericCallables: { definitionFor: () => undefined } };
  const prepared = prepareRustReadOwnership(input);
  assert.equal(prepared.kind, "resolved", "the raw-result requirements are complete before generic closure");
  const selected = analyzeRustReadOwnership({ requirements: prepared.requirements, movingReads: new Set(), captures: new Map(),
    nativeStorage: { operandFor: () => ({ kind: "resolved", carrier }) }, borrowEffects: effects,
    definitions: emptyRustTypeDefinitions, typeFamilies: { implementation: () => undefined },
    genericRequirements: { contractFor: declaration => Object.freeze({ declaration,
      typeParameters: [], capturedTypeParameters: [], nativeInputs: [], associatedTypes: [],
      projectProjections: [], optionalStorage: [] }) },
    genericCallables: input.genericCallables });
  return { node, abi, other, input, prepared, selected };
}

test("provider field and index ownership uses the native raw carrier before conversion", async () => {
  for (const form of ["field", "index"]) {
    const input = await fixture({ form, carrier: rustBorrowedStrTargetType(), conversion: rustStringToBorrowedStrValueConversion });
    assert.equal(input.selected.kind, "resolved", form);
    const requirement = input.prepared.requirements.nativeResults.get(input.node)[0];
    const selected = input.selected.ownership.reads.get(input.node).nativeResults[0];
    assert.equal(requirement.carrier === input.abi.result.rawCarrier, true, `${form}: original raw carrier identity`);
    assert.equal(requirement.copy, false, `${form}: the raw String is not the converted Copy reference`);
    assert.equal(requirement.requiresClone, false, `${form}: a conversion that borrows does not need a snapshot`);
    assert.equal(selected.read.kind, "borrow", `${form}: the conversion borrows the raw place`);
    assert.equal(selected.carrier === input.abi.result.rawCarrier, true, `${form}: publication retains exact native carrier identity`);
    const diagnostics = [];
    const context = { input: { program: { ownership: input.selected.ownership } }, diagnostics };
    const place = planRustFinalizedOperationForm(context, input.abi, { kind: "path", path: "holder" },
      form === "index" ? [{ kind: "integer", value: 0n }] : [], input.node, { resultUse: "value", assignment: false });
    assert.equal(place.kind, form, `${form}: rendering consumes the admitted native read without cloning`);
    assert.equal(diagnostics.length, 0, `${form}: the backend performs no source rejection`);
    const forged = Object.freeze({ ...input.abi });
    assert.throws(() => planRustFinalizedOperationForm(context, forged, { kind: "path", path: "holder" },
      form === "index" ? [{ kind: "integer", value: 0n }] : [], input.node, { resultUse: "value", assignment: false }),
    /Admitted provider storage read requires its exact raw-result ownership/u, `${form}: equal-looking foreign ABI is not admitted`);
  }
});

test("a Copy native reference is not cloned because its converted owned result is non-Copy", async () => {
  for (const form of ["field", "index"]) {
    const input = await fixture({ form, conversion: rustBorrowedStrToStringValueConversion });
    assert.equal(input.selected.kind, "resolved", form);
    const selected = input.selected.ownership.reads.get(input.node).nativeResults[0];
    assert.equal(selected.read.kind, "copy", `${form}: the original native reference is copied`);
    assert.equal(selected.carrier === input.abi.result.rawCarrier, true, `${form}: the converted owned String is not the native storage payload`);
    assert.equal(input.prepared.requirements.nativeResults.get(input.node)[0].requiresClone, false,
      `${form}: native Copy does not introduce a Clone bound on the owned result`);
  }
});

test("native raw reads preserve Copy, Clone and borrowed NoClone without inferring an owned value", async () => {
  for (const [carrier, borrowed, kind, requirement] of [
    [integer, false, "copy", false], [string, false, "clone", true], [noClone, true, "borrow", false],
  ]) {
    const input = await fixture({ carrier, borrowed });
    assert.equal(input.selected.kind, "resolved", kind);
    assert.equal(input.prepared.requirements.nativeResults.get(input.node)[0].requiresClone, requirement, kind);
    assert.equal(input.selected.ownership.reads.get(input.node).nativeResults[0].read.kind, kind, kind);
  }
  const refused = await fixture({ carrier: noClone });
  assert.equal(refused.selected.kind, "rejected", "an owned NoClone field snapshot is not available");
  assert.equal(refused.selected.diagnostics[0].code, "RUST_PROVIDER_READ_OWNERSHIP_UNAVAILABLE", "rejection occurs before publication");
  assert.equal("ownership" in refused.selected, false, "a partial native read is not published");
});

test("provider union arms retain each original finalized operation in the same read family", async () => {
  const input = await fixture({ union: true });
  assert.equal(input.selected.kind, "resolved");
  const results = input.selected.ownership.reads.get(input.node).nativeResults;
  assert.equal(results.length, 2, "both actual provider variants retain separate original ABI identities");
  assert.equal(results[0].abi === input.abi, true, "first selected provider arm");
  assert.equal(results[1].abi === input.other.abi, true, "second selected provider arm");
  assert.equal(Object.isFrozen(results), true, "publication is immutable");
  assert.equal(results.every(result => Object.isFrozen(result) && result.read.kind === "clone"), true, "both exact native snapshots are selected once");
});

test("native borrowed-string fields copy their raw reference with exactly the handwritten allocation cost", { timeout: 300_000 }, () => {
  const fixtureRoot = writeGeneratedProject("raw-provider-field-fixture", [
    { path: "Cargo.toml", text: '[package]\nname = "raw_field_fixture"\nversion = "0.0.0"\nedition = "2021"\n' },
    { path: "src/lib.rs", text: "pub struct NativeText { pub text: &'static str }\npub fn count(value: &str) -> i32 { value.len() as i32 }\n" },
  ]);
  const carrier = rustNamedTargetType("raw.fixture.NativeText", "raw_field_fixture::NativeText");
  const provider = createRustProviderPackage({
    id: "raw-field", displayName: "Exact native field ownership", version: "1.0.0",
    modules: [{ moduleSpecifier: "@raw/native", providerModuleId: "raw.native", exports: [{
      id: "@raw/native::NativeText", name: "NativeText", kind: "class", members: [{
        id: "@raw/native::NativeText.text", name: "text", kind: "property", readonly: true, type: { kind: "string" },
      }],
    }, { id: "@raw/native::count", name: "count", kind: "function", signatures: [{
      id: "@raw/native::count(value)", name: "count", parameters: [{ name: "value", type: { kind: "string" } }],
      returnType: { kind: "source-primitive", name: "int32" },
    }] }] }],
    types: [{ exportId: "@raw/native::NativeText", targetCarrier: carrier }],
    carrierPaths: { "raw.fixture.NativeText": "raw_field_fixture::NativeText" },
    carrierTraits: { "raw.fixture.NativeText": { implementations: [] } },
    operations: [{ exportId: "@raw/native::NativeText", memberId: "@raw/native::NativeText.text", operationKind: "property",
      target: { form: "field", name: "text" }, resultCarrier: string, resultConversion: rustBorrowedStrToStringValueConversion,
      resultLoans: { kind: "complete", declarationIdentity: "raw_field_fixture::NativeText::text",
        resultTypeIdentity: "&'static str", valueTypeIdentity: "&'static str", loans: [] },
    }, { exportId: "@raw/native::count", operationKind: "method",
      target: { form: "call", path: "raw_field_fixture::count", argModes: ["value"],
        argConversions: [rustStringToBorrowedStrValueConversion] },
      parameterCarriers: [string], resultCarrier: integer,
      resultLoans: { kind: "complete", declarationIdentity: "raw_field_fixture::count",
        resultTypeIdentity: "i32", valueTypeIdentity: "i32", loans: [] },
    }],
    crates: [{ crateName: "raw_field_fixture", cargoPath: fixtureRoot }],
  });
  const { result } = compileRust({ packages: [provider],
    target: { id: "rust", options: { outputType: "lib", crateName: "raw_field_control" } },
    files: { "index.ts": 'import { NativeText, count } from "@raw/native";\nexport function read(value: NativeText): string { return value.text; }\nexport function length(value: NativeText): number { return count(value.text); }\n' },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
  const program = result.program;
  assert.equal(program !== undefined, true, "the real target pipeline publishes its completed native input proofs");
  assert.equal(nativeMethods(nativeFunction(result, "read"), "clone").length, 0, "the native &str field is Copy, not the converted String");
  assert.equal(nativeMethods(nativeFunction(result, "length"), "clone").length, 0, "borrowing the already-owned converted result needs no new snapshot");
  const converted = [...program.ownership.nativeInputs.values()].find(input => input.kind === "place" &&
    program.source.ast.is.IsPropertyAccessExpression(input.node));
  assert.equal(converted !== undefined, true, "the outer borrowed call uses the original authored field-result input");
  assert.equal(converted.place.storage.kind, "owned", "the actual conversion forms a new native String, not the source field place");
  assert.equal(converted.place.sourcePath, undefined, "the new value does not forge the native receiver's storage provenance");
  assert.equal(program.ownership.reads.get(converted.node).readsStorage, false, "raw field storage does not become converted result storage");
  const directory = writeGeneratedProject("raw-provider-field-native", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/field.rs"), `use raw_field_control::index::{length, read};
use raw_field_fixture::NativeText;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);
static BYTES: AtomicUsize = AtomicUsize::new(0);
#[global_allocator]
static ALLOCATOR: Counting = Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }
}

fn handwritten(value: NativeText) -> String { value.text.to_owned() }
fn handwritten_length(value: NativeText) -> f64 { raw_field_fixture::count(&value.text.to_owned()) as f64 }

#[test]
fn identical_native_field_cost() {
    ALLOCATIONS.store(0, Ordering::Relaxed);
    BYTES.store(0, Ordering::Relaxed);
    let actual = read(NativeText { text: "native-value" });
    let allocations = ALLOCATIONS.load(Ordering::Relaxed);
    let bytes = BYTES.load(Ordering::Relaxed);
    ALLOCATIONS.store(0, Ordering::Relaxed);
    BYTES.store(0, Ordering::Relaxed);
    let expected = handwritten(NativeText { text: "native-value" });
    let expected_allocations = ALLOCATIONS.load(Ordering::Relaxed);
    let expected_bytes = BYTES.load(Ordering::Relaxed);
    assert_eq!(actual, expected);
    assert_eq!(allocations, expected_allocations);
    assert_eq!(bytes, expected_bytes);
    assert_eq!(allocations, 1);
    assert_eq!(bytes, 12);
    ALLOCATIONS.store(0, Ordering::Relaxed);
    BYTES.store(0, Ordering::Relaxed);
    let actual_length = length(NativeText { text: "native-value" });
    let actual_allocations = ALLOCATIONS.load(Ordering::Relaxed);
    let actual_bytes = BYTES.load(Ordering::Relaxed);
    ALLOCATIONS.store(0, Ordering::Relaxed);
    BYTES.store(0, Ordering::Relaxed);
    let expected_length = handwritten_length(NativeText { text: "native-value" });
    let expected_allocations = ALLOCATIONS.load(Ordering::Relaxed);
    let expected_bytes = BYTES.load(Ordering::Relaxed);
    assert_eq!(actual_length, expected_length);
    assert_eq!(actual_allocations, expected_allocations);
    assert_eq!(actual_bytes, expected_bytes);
    assert_eq!((actual_allocations, actual_bytes), (1, 12));
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline", "--test", "field", "--", "--test-threads=1"]);
});
