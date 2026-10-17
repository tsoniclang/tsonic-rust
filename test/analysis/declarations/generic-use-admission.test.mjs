import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { rustFinalContractSupportsRequirements } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { analyzeRustReadOwnership, prepareRustReadOwnership } from "../../../dist/analysis/ownership/reads.js";
import { analyzeRustReadUses } from "../../../dist/analysis/ownership/uses.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";

const parameter = Object.freeze({ kind: "type-parameter", identity: "Owner", name: "Owner" });
const families = Object.freeze({ implementation: () => undefined });
const contract = fields => Object.freeze({ declaration: Object.freeze({}),
  typeParameters: [], capturedTypeParameters: [], nativeInputs: [], associatedTypes: [],
  projectProjections: [], optionalStorage: [], ...fields });
const bound = requirements => Object.freeze({ identity: parameter.identity, name: parameter.name,
  requirements: Object.freeze(requirements) });

test("all final generic domains use one analysis-only required-list classifier without inferring missing bounds", () => {
  for (const domain of ["typeParameters", "capturedTypeParameters", "nativeInputs"]) {
    for (const requirement of ["clone", "default", "static"]) {
      const missing = contract({ [domain]: [bound([])] });
      const present = contract({ [domain]: [bound([requirement])] });
      assert.equal(rustFinalContractSupportsRequirements(missing, parameter, [requirement], families,
        emptyRustTypeDefinitions, undefined).kind, "unsatisfied", `${domain}/${requirement}: absent bound`);
      assert.equal(rustFinalContractSupportsRequirements(present, parameter, [requirement], families,
        emptyRustTypeDefinitions, undefined).kind, "supported", `${domain}/${requirement}: exact final bound`);
      assert.equal(missing[domain][0].requirements.length, 0, `${domain}/${requirement}: no inference or mutation`);
    }
  }
  assert.equal(rustFinalContractSupportsRequirements(contract({}), parameter, ["clone"], families,
    emptyRustTypeDefinitions, undefined).kind, "unresolved", "an unknown free parameter is never a Clone assumption");
  const optional = contract({ optionalStorage: [{ carrier: parameter, captured: false, requirements: ["clone"] }] });
  assert.equal(rustFinalContractSupportsRequirements(optional, parameter, ["clone"], families,
    emptyRustTypeDefinitions, undefined).kind, "supported", "the actual optional-storage parameter is included");
});

test("final associated Clone evidence is exact and independent of its owner's traits", () => {
  const projection = { kind: "associated-type", owner: parameter,
    trait: { kind: "trait-ref", id: "native::Family", path: "native::Family", genericArguments: [], associatedConstraints: [] },
    name: "Output" };
  const missing = contract({ nativeInputs: [bound(["clone"])] });
  const present = contract({ nativeInputs: [bound([])], associatedTypes: [{ carrier: projection, requirements: ["clone"] }] });
  for (const [selected, carrier, expected] of [[missing, projection, "unsatisfied"],
    [present, projection, "supported"], [present, { ...projection, name: "Other" }, "unsatisfied"]]) {
    assert.equal(rustFinalContractSupportsRequirements(selected, carrier, ["clone"], families,
      emptyRustTypeDefinitions, undefined).kind, expected, `${expected}: exact associated output bound`);
  }
});

test("published native module and callable contracts expose only their completed immutable lookup surface", () => {
  const { result } = compileRust({ files: { "index.ts": `
import { allocateptr, defaultvalue } from "@tsonic/core/lang.js";
import type { Pointer } from "@tsonic/core/types.js";
export const retained = allocateptr("module");
export function duplicate<T>(value: T): [T, T] { return [value, value]; }
export function initialize<T>(): T { return defaultvalue<T>(); }
export function retain<T>(value: T): Pointer<T> { return allocateptr(value); }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const program = result.program;
  assert.equal(program !== undefined, true, "all required native uses are admitted before publication");
  const index = program.declarationGenericRequirements;
  assert.equal(Object.isFrozen(index), true, "the published index is immutable");
  assert.equal(Object.keys(index).sort().join(","),
    "contractFor,contractForCarrier,contractForStructuralView,projectionImplementationsFor", "pure completed lookup API only");
  assert.equal("supportsClone" in index, false, "no computing Clone query escapes analysis");
  assert.equal("hasUse" in index, false, "no backend membership validator escapes analysis");
  const sourceFile = program.sourceFiles.find(file => program.source.ast.getFileName(file).endsWith("index.ts"));
  assert.equal(sourceFile !== undefined, true, "the native source file is present");
  assert.equal(index.contractFor(sourceFile) !== undefined, true, "module initialization uses the same admitted scope closure");
  for (const [name, required] of [["duplicate", ["clone"]], ["initialize", ["default"]], ["retain", ["clone", "static"]]]) {
    const declaration = program.source.ast.statements(sourceFile).find(node => node !== undefined &&
      program.source.ast.is.IsFunctionDeclaration(node) && program.source.ast.text(program.source.ast.name(node)) === name);
    assert.equal(declaration !== undefined, true, `${name}: original declaration`);
    const selected = index.contractFor(declaration);
    assert.equal(selected !== undefined && Object.isFrozen(selected), true, `${name}: completed contract`);
    for (const requirement of required) assert.equal(selected.typeParameters[0].requirements.includes(requirement), true,
      `${name}: exact ${requirement} requirement admitted upstream`);
    assert.equal(index.contractFor(declaration), selected, `${name}: stable data identity`);
  }
});

test("an unproved associated owned copy is rejected once at pre-seal read admission, while the identical move and borrow stay valid", async () => {
  const source = createTargetSourceProgram(await checkedSource("associated-copy-admission", {
    "src/index.ts": "function read<Owner>(value: Owner | null) { return value; }",
  }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const nodes = storage.nodes;
  const declaration = nodes.find(node => source.ast.is.IsFunctionDeclaration(node));
  const binding = source.ast.parameters(declaration)[0];
  const reference = nodes.find(node => source.ast.is.IsIdentifier(node) && source.ast.text(node) === "value" &&
    source.ast.kindName(source.ast.parent(node)) === "KindReturnStatement");
  assert.equal(reference !== undefined && binding !== undefined, true, "the original optional associated read has an exact source identity");
  const selectedCarrier = { kind: "associated-type", owner: parameter,
    trait: { kind: "trait-ref", id: "native::Family", path: "native::Family", genericArguments: [], associatedConstraints: [] },
    name: "Output" };
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const builder = createRustProgramRecordBuilder();
  builder.runtimeCarriers.selected(reference, sourceCarrier);
  builder.sourceBindings.lexical(reference, binding, "value");
  const projection = builder.flowReadProjections.resolve([], reference, sourceCarrier, selectedCarrier, {}, emptyRustTypeDefinitions);
  assert.equal(projection.kind, "projection", "payload selection does not invent an associated Clone implementation");
  const records = builder.seal([]);
  const nativeNodes = new Set(nodes);
  const selected = contract({ declaration, nativeInputs: [bound([])] });
  for (const mode of ["move", "borrow", "copy"]) {
    const uses = new Map(analyzeRustReadUses(source.ast, nodes, records));
    if (mode === "borrow") uses.set(reference, { mode: "shared", later: [], laterStart: 0, stableAcrossEffects: true });
    const input = {
      storage, nativeNodes: nodes, records,
      movingReads: new Set(mode === "move" ? [reference] : []),
      flow: { readTransfers: new Map(), captureRequirements: new Map(), captureTransfers: new Map(), graphs: new Map(), liveness: new Map() },
      captures: new Map(),
      nativeStorage: { operandFor: node => ({ kind: "resolved", carrier: records.runtimeCarrier.get(node).carrier }) },
      borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
      borrowEffectsInput: { ast: source.ast, records, navigation: source.navigation, readUses: uses,
        isNativeNode: node => nativeNodes.has(node) },
      definitions: emptyRustTypeDefinitions, typeFamilies: families,
      genericRequirements: { contractFor: () => selected }, genericCallables: { definitionFor: () => undefined },
    };
    const prepared = prepareRustReadOwnership(input);
    assert.equal(prepared.kind, "resolved", `${mode}: the original complete source inventory is valid`);
    const result = analyzeRustReadOwnership({ ...input, requirements: prepared.requirements });
    if (mode === "copy") {
      assert.equal(result.kind, "rejected", "no unproved owned associated copy reaches the planner");
      assert.equal(result.diagnostics.length, 1, "the same negative case produces exactly one admission diagnostic");
      assert.equal(result.diagnostics[0].code, "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", "the read owner reports the missing proof");
      assert.equal(result.diagnostics[0].sourceNode === reference, true, "the diagnostic retains the original read");
      assert.match(result.diagnostics[0].message, /proven transfer, Copy or Clone contract/u, "the actual non-consuming Clone reason is preserved");
      assert.equal("ownership" in result, false, "failed read facts are not published");
    } else {
      assert.equal(result.kind, "resolved", `${mode}: no speculative Clone bound is required`);
      assert.equal(result.ownership.reads.get(reference).value.kind, mode, `${mode}: exact admitted ownership`);
    }
  }
});
