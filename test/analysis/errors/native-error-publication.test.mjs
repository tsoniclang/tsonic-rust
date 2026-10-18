import assert from "node:assert/strict";
import test from "node:test";
import { publishRustErrorRegion, publishRustNativeErrorSources } from "../../../dist/analysis/errors/regions.js";
import { selectRustNativeTypeCarrier } from "../../../dist/policy/types/model/native-type-selection.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";

const input = { typeDefinitions: emptyRustTypeDefinitions, typeParameterNames: undefined,
  pathFor: () => undefined, additionalArgumentsFor: () => undefined, programErrorCarrier: () => undefined,
  producerErrorCarrier: () => undefined, nativeErrorJoinCarrier: () => undefined, structuralCarrier: () => undefined };
const node = Object.freeze({ fixture: "original-source-error" });
const integer = Object.freeze({ kind: "source-primitive", name: "int32" });

test("the single physical request selection consumes completed logical demands before native payload publication", () => {
  let requested;
  let requestSelections = 0;
  let earlySourceRows = 0;
  const context = analyzeRustErrorEffects(`
export function invoke(action: () => number): number { return action(); }
export function run(): number { return invoke(() => 3); }
`, { surfaces: [] }, current => {
    const original = current.callableValues;
    return { ...current, callableValues: Object.create(original, {
      finalizeSelected: { value(sourceErrorOperandRequired) {
        requestSelections += 1;
        assert.equal(typeof sourceErrorOperandRequired, "function", "the logical demand owner is a required construction input");
        requested = new Map(current.nativeNodes.map(node => {
          const needed = sourceErrorOperandRequired(node);
          if (needed) {
            earlySourceRows += 1;
            assert.equal(current.records.sourceErrorEffects.get(node) === undefined, true,
              "native source payloads have not been fabricated before physical selection");
            assert.equal(current.records.awaitSourceErrorEffects.get(node) === undefined, true,
              "native await payloads have not been fabricated before physical selection");
            assert.equal(current.records.genericCallableInvocation.get(node) === undefined, true,
              "native generic payloads have not been fabricated before physical selection");
          }
          return [node, needed];
        }));
        return original.finalizeSelected(sourceErrorOperandRequired);
      } },
    }) };
  });
  assert.equal(requestSelections, 1, "the selecting lifecycle is not repeated after native error completion");
  assert.equal(earlySourceRows > 0, true, "ordinary invocation edges already require exact source operands");
  for (const node of context.nativeNodes) {
    const finalRequired = (context.records.sourceErrorEffects.get(node)?.edges.length ?? 0) !== 0 ||
      (context.records.awaitSourceErrorEffects.get(node)?.branches.length ?? 0) !== 0 ||
      context.records.genericCallableInvocation.get(node) !== undefined;
    assert.equal(requested.get(node), finalRequired, "physical payload completion never changes original logical demand membership");
  }
});

test("late native error publication preserves the complete source row without mutating its preparation", () => {
  const sources = Object.freeze([Object.freeze({ identity: "actual:first", variant: "Error0", errorType: integer }),
    Object.freeze({ identity: "actual:second", variant: "Error1", errorType: integer })]);
  const prepared = Object.freeze({ kind: "native", fileName: "/native.ts", localOwner: undefined, sources });
  const selected = publishRustErrorRegion(prepared, node, input);
  assert.equal(selected.kind, "resolved", "the real native payload is nameable in an enum field");
  assert.equal(selected.value.sources.length, 2, "coincident native types retain both original identities");
  for (const [index, source] of selected.value.sources.entries()) {
    assert.equal(source.identity, sources[index].identity, `identity ${index}`);
    assert.equal(source.variant, sources[index].variant, `variant ${index}`);
    assert.equal(source.errorType === sources[index].errorType, true, `original carrier ${index}`);
    assert.equal(rustTargetTypeRefEquals(source.nativeType, integer), true, `selected native carrier ${index}`);
    assert.equal(Object.isFrozen(source), true, `immutable final row ${index}`);
    assert.equal(Object.hasOwn(sources[index], "nativeType"), false, `immutable early source ${index}`);
  }
  assert.equal(Object.isFrozen(selected.value) && Object.isFrozen(selected.value.sources), true, "final publication is immutable");
});

test("unresolved and opaque enum payloads are rejected at admission, not by a generated-AST checker", () => {
  const anonymous = { kind: "impl-trait", id: "fixture:anonymous-native-error", bounds: [{ kind: "trait-ref",
    id: "core::fmt::Debug", path: "core::fmt::Debug", genericArguments: [], associatedConstraints: [] }], outlives: [] };
  const nested = rustNamedTargetType("fixture:Option", "Option", [{ kind: "type", type: anonymous }], [], undefined, [], undefined, []);
  for (const [label, carrier] of [["unresolved inference", { kind: "opaque", id: "fixture:missing-native-error" }],
    ["opaque enum field", anonymous], ["nested opaque enum field", nested]]) {
    const selected = publishRustNativeErrorSources([{ identity: label, variant: "Error0", errorType: carrier }], node, input);
    assert.equal(selected.kind, "rejected", `${label}: no unadmitted payload reaches planning`);
    assert.equal(Object.hasOwn(selected, "value"), false, `${label}: no partial publication`);
    assert.equal(selected.diagnostics.length, 1, `${label}: one source diagnostic`);
    assert.equal(selected.diagnostics[0].code, "RUST_NATIVE_ERROR_PAYLOAD_NOT_REPRESENTABLE", `${label}: analysis owns admission`);
    assert.equal(selected.diagnostics[0].sourceNode === node, true, `${label}: original source identity`);
  }
  for (const position of ["parameter", "return"])
    assert.equal(selectRustNativeTypeCarrier(anonymous, input, position).kind, "resolved", `${position}: native signature capability retained`);
});

test("each actual emitted context owns its final source-error channels and rejects foreign lookup identities", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function invoke(action: () => number): number { return action(); }
export function run(): number { return invoke(() => 3); }
` } });
  assert.equal(Object.hasOwn(program.errorRegions, "get"), false, "no declaration-global native selection route");
  assert.equal(Object.hasOwn(program.errorRegions, "sourceFor"), false, "no edge-global physical selection route");
  let sourceEdges = 0;
  for (const context of program.physicalEmissionContexts.contexts) {
    if (context.error.kind === "region") for (const source of context.error.region.sources)
      assert.equal(Object.hasOwn(source, "nativeType"), true, "every final native region payload is admitted");
    assert.equal(program.physicalEmissionContexts.contextFor(context.use) === context, true, "the index returns final contexts");
  }
  for (const operand of program.physicalEmissionContexts.operands) {
    for (const selected of operand.sourceErrorRegions) {
      sourceEdges += 1;
      assert.equal(program.physicalEmissionContexts.sourceErrorOperandFor(operand.context.use, operand.node) === operand, true,
        "the exact actual use owns its edge rows");
      assert.equal(program.physicalEmissionContexts.sourceErrorOperandFor({ ...operand.context.use }, operand.node) === undefined, true,
        "a copied context cannot forge the original emission identity");
      assert.equal(program.physicalEmissionContexts.sourceErrorOperandFor(operand.context.use, { ...operand.node }) === undefined, true,
        "a copied source node cannot forge the selected edge");
      for (const source of selected.selection.operand.sources)
        assert.equal(Object.hasOwn(source, "nativeType") && Object.isFrozen(source), true, "final operand native payload is immutable");
    }
  }
  assert.equal(sourceEdges > 0, true, "the real source invocation exercises actual channel publication");
});

test("synthesized callable adapters retain original helper slots and the selected native join owner", () => {
  const { program } = analyzeRust({ surfaces: [], files: {
    "contract.ts": `export interface Wide { get(): () => number | undefined; }`,
    "model.ts": `import type { Wide } from "./contract.js";
export class Concrete implements Wide { get(): () => number { return () => 7; } }`,
    "index.ts": `import type { Wide } from "./contract.js";
import { Concrete } from "./model.js";
export function run(): number | undefined { const selected: Wide = new Concrete(); return selected.get()(); }`,
  } });
  const definition = program.projectTypes.definitions.find(candidate => candidate.targetName === "Concrete");
  assert.equal(definition !== undefined, true, "the actual concrete type is selected");
  const adapters = program.records.projectCallableAdapters.get(definition.declaration);
  const selected = adapters.find(adapter => adapter.resultAdapter.kind === "conversion" &&
    adapter.resultAdapter.conversion.kind === "callable-adapter");
  assert.equal(selected !== undefined, true, "the original method contract selects a result adaptation");
  const context = program.physicalEmissionContexts.contextForOwner(selected, "helper");
  assert.equal(context !== undefined, true, "the generated helper has its own complete physical environment");
  const conversion = selected.resultAdapter.conversion;
  const row = context.callableAdapters.find(candidate => candidate.node === selected.contract && candidate.selection === conversion);
  assert.equal(row !== undefined, true, "the helper consumes the exact original logical selection identity");
  assert.equal(row.origin.kind === "return" && row.origin.declaration === selected.implementation, true,
    "a result slot is not fabricated as a runtime AST operand");
  assert.equal(row.joinOwnerFileName, definition.fileName, "join ownership is selected with the actual concrete helper");
  const contractFile = program.source.ast.getFileName(program.source.ast.getSourceFile(selected.contract));
  assert.notEqual(row.joinOwnerFileName, contractFile, "a foreign contract node cannot replace the native helper's catalog");
  assert.equal(Object.isFrozen(context.callableAdapters) && Object.isFrozen(row), true, "the complete helper descriptors seal once");
  assert.equal(Object.hasOwn(row.conversion, "nativeErrorType"), true, "the nested physical descriptor publishes its admitted native error");
  assert.equal(program.physicalEmissionContexts.contextForOwner({ ...selected }, "helper") === undefined, true,
    "equal-shaped helper records cannot impersonate an admitted original owner");
});
