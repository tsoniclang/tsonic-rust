import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNativeResultPlaces, selectRustResultLoanSources } from "../../../dist/analysis/ownership/result-loans.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/operations/finalized-operation/finalize.js";
import { rustFinalizedSourceInputs } from "../../../dist/analysis/operations/finalized-operation/conversions.js";
import { rustBorrowedStrToStringValueConversion } from "../../../dist/target-model/conversions/model.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const ownerCarrier = { kind: "target-named", id: "native.Owner" };
const guardCarrier = { kind: "target-named", id: "native.Guard", genericArguments: [
  { kind: "lifetime", lifetime: { kind: "placeholder" } },
] };
const stringCarrier = { kind: "target-named", id: "rust.std.String" };

function relation(kind = "borrow") {
  return { kind: "complete", declarationIdentity: "native::Owner::guard", resultTypeIdentity: "native::Guard<'declared>",
    valueTypeIdentity: "native::Guard<'declared>", loans: [{ resultPath: ["argument:0"], lifetime: "declared:Owner::guard:owner",
      origins: [{ kind, input: { kind: "receiver" }, inputType: "native::Owner", inputPath: [],
        lifetime: "declared:Owner::guard:owner", mutable: false }] }] };
}

function fixture(options = {}) {
  const contract = options.resultLoans ?? relation();
  const sourceCarrier = options.sourceCarrier ?? ownerCarrier;
  const resultCarrier = options.resultCarrier ?? guardCarrier;
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "receiver-method", method: "guard", receiverMode: options.receiverMode ?? "ref" },
    sourceReceiver: { kind: "runtime", carrier: sourceCarrier }, sourceArgumentCarriers: [], resultCarrier,
    resultLoans: contract, ...(options.resultConversion === undefined ? {} : { resultConversion: options.resultConversion }),
    isAsync: false, isFallible: false });
  assert.equal(abi !== undefined, true, "the unit's declared native ABI is valid before place selection");
  const node = {};
  const sourceNode = {};
  const declaration = {};
  const contextUse = Object.freeze({ subject: declaration, role: "body", enclosingContract: "fixture:body" });
  const context = Object.freeze({ use: contextUse, declaration,
    bindings: { types: new Map(), lifetimes: new Map(), consts: new Map() },
    returnDestination: { kind: "none" }, error: { kind: "none" }, operands: [sourceCarrier, resultCarrier] });
  const operation = Object.freeze({ kind: "provider-operation", operationId: "native::guard", abi, resultCarrier });
  const selectedInput = rustFinalizedSourceInputs(abi)[0];
  const use = Object.freeze({ subject: selectedInput, role: "call-input:receiver:0", enclosingContract: "fixture:body" });
  const slot = Object.freeze({ key: "receiver", node: sourceNode, operationNode: node, operation,
    source: { kind: "receiver", row: abi.sourceReceiver } });
  const operand = Object.freeze({ use, node: sourceNode, context,
    origin: { kind: "call-input", operationNode: node, operation, input: selectedInput },
    carrier: sourceCarrier, destination: selectedInput.parameterCarrier });
  const place = Object.freeze({ input: selectedInput, key: "receiver", node: sourceNode, slot, operand,
    place: Object.freeze({ node: sourceNode, operand, carrier: sourceCarrier,
      sourcePath: { declaration, projections: [] }, storage: { kind: "direct" } }) });
  const occurrence = Object.freeze({ node, operation, slots: [slot], inputs: [{ input: selectedInput, slot }], targetOrder: ["receiver"] });
  const physicalEmissionContexts = { contexts: [context], operands: [operand], sourceOccurrences: [occurrence],
    contextFor: selected => selected === contextUse ? context : undefined,
    operandFor: selected => selected === use ? operand : undefined,
    sourceFor: (selectedNode, selectedOperation) => selectedNode === node && selectedOperation === operation ? occurrence : undefined,
    carrierFor: (selected, carrier) => selected === contextUse && carrier === abi.result.carrier ? resultCarrier : undefined };
  const input = { physicalEmissionContexts, nativePlaces: new Map([[use, place]]), definitions: emptyRustTypeDefinitions };
  return { node, operation, contextUse, context, input, place };
}

test("returned native relations bind original physical input places without claiming cleanup liveness", () => {
  const selected = fixture();
  const result = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(result.kind, "resolved", "the exact declared relation is available");
  assert.equal(result.context === selected.context, true, "the actual context is retained");
  assert.equal(result.native === selected.operation.abi.result.resultLoans, true, "the final native relation is canonical");
  assert.equal(result.loans.length, 1, "one actual result lifetime position");
  assert.equal(result.loans[0].declaration === result.native.loans[0].loan, true, "no copied native declaration row");
  assert.equal(result.loans[0].origins[0].input === selected.place, true, "the same admitted physical input is used");
  assert.equal(result.loans[0].origins[0].kind, "borrow", "a native reference formal borrows the source place");
  assert.equal("scopeLive" in result || "dropProven" in result, false, "signature relations do not certify destructor or live interval facts");
});

test("a native by-value input carries its existing loan instead of borrowing its storage", () => {
  const selected = fixture({ sourceCarrier: guardCarrier, receiverMode: "value", resultLoans: relation("carried") });
  const result = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(result.kind, "resolved", "the declared by-value relation is available");
  assert.equal(result.loans[0].origins[0].kind, "carried", "native lifetime payload is not replaced with a borrow of its containing value");
  assert.equal(result.loans[0].origins[0].input === selected.place, true, "the original actual input is retained for source provenance");
});

test("owned-string result conversion ends the transient reference relation, not the source value", () => {
  const contract = relation();
  contract.resultTypeIdentity = "&'declared str";
  contract.valueTypeIdentity = "&'declared str";
  contract.loans[0].resultPath = ["reference"];
  const selected = fixture({ sourceCarrier: stringCarrier, resultCarrier: stringCarrier,
    resultConversion: rustBorrowedStrToStringValueConversion, resultLoans: contract });
  const result = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(result.kind, "resolved", "the selected native to-owned conversion has an exact relation effect");
  assert.equal(result.loans.length, 0, "the owned native String does not retain the transient reference");
  assert.equal(result.native.loans.length, 1, "the original raw native relation was not deleted or misreported as loan-free");
});

test("returned native relations reject copied input and context identities", () => {
  const selected = fixture();
  const copied = { ...selected.place, input: { ...selected.place.input } };
  const changed = { ...selected.input, nativePlaces: new Map([[selected.place.operand.use, copied]]) };
  assert.equal(selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, changed).kind,
    "unavailable", "a copied finalized source input is not the original ABI input");
  assert.equal(selectRustNativeResultPlaces(selected.node, selected.operation, { ...selected.contextUse }, selected.input).kind,
    "unavailable", "a structurally equal context cannot claim another use's proof");
  assert.equal(selectRustNativeResultPlaces(selected.node, { ...selected.operation }, selected.contextUse, selected.input).kind,
    "unavailable", "a replacement operation cannot claim an original source occurrence");
});

test("unavailable generic native result evidence never becomes a known empty relation", () => {
  const selected = fixture({ resultLoans: { ...relation(), kind: "unavailable", loans: [],
    reasons: ["The selected type parameter has no normalized lifetime correspondence."] } });
  const result = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(result.kind, "unavailable", "unknown native provenance stays unknown");
  assert.equal(result.reasons[0], "The selected type parameter has no normalized lifetime correspondence.",
    "the actual missing native fact is preserved");
  assert.equal("loans" in result, false, "there is no fabricated empty accepted payload");
});

test("source provenance keeps original activation alternatives and never inverts target generic bindings", () => {
  const selected = fixture();
  const relation = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(relation.kind, "resolved", "the actual native input-place relation is available first");
  const ownerBindings = Object.freeze({ substitutions: [] });
  const firstBindings = Object.freeze({ substitutions: [] });
  const secondBindings = Object.freeze({ substitutions: [] });
  const subject = Object.freeze({ kind: "value", node: selected.place.node, projection: [] });
  const firstSource = Object.freeze({ kind: "value", node: {}, projection: [] });
  const secondSource = Object.freeze({ kind: "value", node: {}, projection: [] });
  const activations = [firstBindings, secondBindings].map(bindings => Object.freeze({ kind: "declaration",
    declaration: selected.context.declaration, bindings }));
  const queried = [];
  const storage = {
    subjectFor: node => {
      assert.equal(node === selected.place.node, true, "the selected original input node is queried");
      return { kind: "resolved", subject };
    },
    boundActivationsFor: (declaration, bindings) => {
      assert.equal(declaration === selected.context.declaration && bindings === ownerBindings, true,
        "the original owning input bindings, not target substitutions, are supplied");
      return { kind: "resolved", activations };
    },
    boundOriginsFor: (selectedSubject, bindings) => {
      assert.equal(selectedSubject === subject, true, "the canonical checked source subject is retained");
      assert.equal(bindings === firstBindings || bindings === secondBindings, true, "an actual activation token is required");
      queried.push(bindings);
      return { kind: "resolved", subjects: [bindings === firstBindings ? firstSource : secondSource] };
    },
  };
  const result = selectRustResultLoanSources(relation, ownerBindings, { storage });
  assert.equal(result.kind, "resolved", "both real source activations remain distinct");
  assert.equal(result.alternatives.length, 2, "no first-activation selection");
  for (const [index, source] of [firstSource, secondSource].entries()) {
    const alternative = result.alternatives[index];
    assert.equal(alternative.activation === activations[index], true, `original activation ${index}`);
    assert.equal(alternative.loans[0].origins[0].sources.length, 1, `no independently merged source set ${index}`);
    assert.equal(alternative.loans[0].origins[0].sources[0] === source, true, `the corresponding original source ${index}`);
    assert.equal(alternative.loans[0].origins[0].native === relation.loans[0].origins[0], true,
      `the same native input/place relation ${index}`);
  }
  assert.equal(queried.length, 2, "one source query per original input and activation");
  assert.equal(queried[0] === firstBindings && queried[1] === secondBindings, true, "each source query keeps its actual binding token");
});

test("missing actual activation bindings remain unavailable without a declaration or empty fallback", () => {
  const selected = fixture();
  const relation = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(relation.kind, "resolved", "native relation available independently of source activation");
  let origins = 0;
  const input = { storage: { subjectFor: () => ({ kind: "resolved", subject: { kind: "value", node: selected.place.node, projection: [] } }),
    boundActivationsFor: () => ({ kind: "unresolved", reason: "The supplied source-binding token belongs to another query." }),
    boundOriginsFor: () => { origins += 1; throw new Error("No fallback binding is admissible."); } } };
  const result = selectRustResultLoanSources(relation, { substitutions: [] }, input);
  assert.equal(result.kind, "unavailable", "foreign original bindings cannot be replaced");
  assert.equal(result.reasons[0], "The supplied source-binding token belongs to another query.", "the actual missing input remains explicit");
  assert.equal(origins, 0, "no query runs on invented or declaration-scope bindings");
});
