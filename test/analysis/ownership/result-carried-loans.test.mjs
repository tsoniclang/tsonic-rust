import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustNativeResultLoans, selectRustNativeResultPlaces,
  selectRustResultLoanSources } from "../../../dist/analysis/ownership/result-loans.js";
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
    form: options.receiverMode === "value"
      ? { form: "free-call", path: "native::guard", receiverMode: "value" }
      : { form: "receiver-method", name: "guard", ...(options.receiverMode === "mut-ref" ? { mutatesReceiver: true } : {}) },
    sourceReceiver: { kind: "runtime", carrier: sourceCarrier }, sourceArgumentCarriers: [], resultCarrier,
    resultLoans: contract, ...(options.resultConversion === undefined ? {} : { resultConversion: options.resultConversion }),
    isAsync: options.isAsync ?? false, isFallible: false });
  assert.equal(abi !== undefined, true, "the unit's declared native ABI is valid before place selection");
  const node = {};
  const sourceNode = {};
  const declaration = {};
  const contextUse = Object.freeze({ subject: declaration, role: "body", enclosingContract: "fixture:body" });
  const operation = Object.freeze({ kind: "provider-operation", operationId: "native::guard", abi, resultCarrier });
  const selectedInput = rustFinalizedSourceInputs(abi)[0];
  const slot = Object.freeze({ key: "receiver", node: sourceNode, operationNode: node, operation,
    source: { kind: "receiver", row: abi.sourceReceiver } });
  const occurrence = Object.freeze({ node, operation, slots: [slot], inputs: [{ input: selectedInput, slot }], targetOrder: ["receiver"] });
  const sourceOrigins = Object.freeze(options.originsForOccurrence?.(contextUse, occurrence, declaration) ?? []);
  const context = Object.freeze({ use: contextUse, declaration,
    bindings: { types: new Map(), lifetimes: new Map(), consts: new Map() },
    returnDestination: { kind: "none" }, error: { kind: "none" }, operands: [sourceCarrier, resultCarrier], sourceOrigins });
  const use = Object.freeze({ subject: selectedInput, role: "call-input:receiver:0", enclosingContract: "fixture:body" });
  const operand = Object.freeze({ use, node: sourceNode, context,
    origin: { kind: "call-input", operationNode: node, operation, input: selectedInput },
    carrier: sourceCarrier, destination: selectedInput.parameterCarrier });
  const place = Object.freeze({ kind: options.receiverMode === "value" ? "value" : "place", input: selectedInput, key: "receiver", node: sourceNode, slot, operand,
    ...(options.receiverMode === "value" ? { read: Object.freeze({ carrier: sourceCarrier, operandCarrier: sourceCarrier,
      formation: { kind: "move" }, value: { kind: "move" }, source: { kind: "move" },
      snapshot: undefined, stablePlace: false, readsStorage: true, pure: true, sharedReference: false, borrowedAcross: new Set() }) }
      : { place: Object.freeze({ node: sourceNode, operand, carrier: sourceCarrier,
      sourcePath: { declaration, projections: [] }, storage: { kind: "direct" } }) }) });
  const physicalEmissionContexts = { contexts: [context], operands: [operand], sourceOccurrences: [occurrence],
    contextFor: selected => selected === contextUse ? context : undefined,
    operandFor: selected => selected === use ? operand : undefined,
    sourceFor: (selectedNode, selectedOperation) => selectedNode === node && selectedOperation === operation ? occurrence : undefined,
    sourceOriginFor: (selected, selectedOccurrence) => selected === contextUse && selectedOccurrence === occurrence
      ? sourceOrigins.find(row => row.occurrence === occurrence) : undefined,
    carrierFor: (selected, carrier) => selected === contextUse && carrier === abi.result.carrier ? resultCarrier : undefined };
  const input = { physicalEmissionContexts, nativeInputs: new Map([[use, place]]), definitions: emptyRustTypeDefinitions };
  return { node, operation, contextUse, context, occurrence, input, place };
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

test("late native result ownership publishes exact operation/context rows with no computing read path", () => {
  const bindings = Object.freeze({ substitutions: [] });
  const selected = fixture({ originsForOccurrence: (use, occurrence, declaration) => [Object.freeze({
    kind: "resolved", use, occurrence,
    subject: Object.freeze({ kind: "value", node: occurrence.node, projection: [] }),
    alternatives: Object.freeze([Object.freeze({ kind: "declaration",
      activation: Object.freeze({ kind: "declaration", declaration, bindings }),
      targetBindings: Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() }) })]),
  })] });
  const inputSubject = Object.freeze({ kind: "value", node: selected.place.node, projection: [] });
  const sourceSubject = Object.freeze({ kind: "value", node: {}, projection: [] });
  let closed = false;
  let subjectQueries = 0;
  let originQueries = 0;
  const storage = {
    subjectFor: node => {
      assert.equal(closed, false, "subject selection happens before publication");
      assert.equal(node === selected.place.node, true, "original actual native operand");
      subjectQueries += 1;
      return { kind: "resolved", subject: inputSubject };
    },
    boundOriginsFor: (subject, actualBindings) => {
      assert.equal(closed, false, "origin selection happens before publication");
      assert.equal(subject === inputSubject && actualBindings === bindings, true, "the original activation/input pair");
      originQueries += 1;
      return { kind: "resolved", subjects: [sourceSubject] };
    },
  };
  const results = analyzeRustNativeResultLoans({ ...selected.input, storage });
  closed = true;
  const record = results.get(selected.node)?.get(selected.operation)?.get(selected.contextUse);
  assert.equal(record !== undefined, true, "one complete late ownership record");
  assert.equal(record.context === selected.context && record.operation === selected.operation, true, "original tuple identity");
  assert.equal(record.place.kind, "resolved", "native declaration/input relation was selected once");
  assert.equal(record.source.kind, "resolved", "actual source alternatives were selected once");
  assert.equal(record.source.alternatives[0].loans[0].origins[0].sources[0] === sourceSubject, true,
    "the published source identity is unchanged");
  assert.equal(Object.isFrozen(record), true, "the exact selected row is immutable");
  for (let index = 0; index < 8; index += 1) {
    assert.equal(results.get(selected.node).get(selected.operation).get(selected.contextUse) === record, true,
      `lookup ${index} reads the same record without source computation`);
  }
  assert.equal(subjectQueries, 1, "no source-subject recomputation after publication");
  assert.equal(originQueries, 1, "no source-origin recomputation after publication");
  assert.equal(results.get(selected.node)?.get({ ...selected.operation }) === undefined, true, "copied operation has no record");
  assert.equal(results.get(selected.node)?.get(selected.operation)?.get({ ...selected.contextUse }) === undefined, true,
    "copied context has no record");
});

test("late native result ownership retains unavailable metadata instead of publishing an empty accepted loan set", () => {
  const selected = fixture({ resultLoans: { ...relation(), kind: "unavailable", loans: [],
    reasons: ["The native declaration retains an unresolved instantiated result type."] },
  originsForOccurrence: (use, occurrence) => [Object.freeze({ kind: "unavailable", use, occurrence,
    reason: "The native source execution remains open." })] });
  const results = analyzeRustNativeResultLoans({ ...selected.input,
    storage: { subjectFor: () => { throw new Error("Unavailable native data does not trigger a speculative source query."); } } });
  const record = results.get(selected.node).get(selected.operation).get(selected.contextUse);
  assert.equal(record.place.kind, "unavailable", "native unknown stays unknown");
  assert.equal(record.source === record.place, true, "the exact original unavailable reason is preserved");
  assert.equal("alternatives" in record.source, false, "no empty accepted-source substitute");
  assert.equal("loans" in record.place, false, "no empty accepted-loan substitute");
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
  const changed = { ...selected.input, nativeInputs: new Map([[selected.place.operand.use, copied]]) };
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

test("a known empty awaited result never certifies its pending native Future has no carried loan", () => {
  const selected = fixture({ isAsync: true, resultLoans: { ...relation(), loans: [] } });
  const result = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(result.kind, "unavailable", "completion-value evidence is not native Future storage evidence");
  assert.equal(result.reasons[0], "The awaited native result relation does not establish the Future value's carried input loans.",
    "the missing physical native contract stays exact");
  assert.equal("loans" in result, false, "no false known-empty physical result");
});

test("source provenance keeps original activation alternatives and never inverts target generic bindings", () => {
  const firstBindings = Object.freeze({ substitutions: [] });
  const secondBindings = Object.freeze({ substitutions: [] });
  const targetBindings = Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
  let activations;
  let originals;
  const selected = fixture({ originsForOccurrence: (use, occurrence, declaration) => {
    activations = [firstBindings, secondBindings].map(bindings => Object.freeze({ kind: "declaration", declaration, bindings }));
    originals = Object.freeze(activations.map(activation => Object.freeze({ kind: "declaration", activation, targetBindings })));
    return [Object.freeze({ kind: "resolved", use, occurrence,
      subject: Object.freeze({ kind: "value", node: occurrence.node, projection: [] }), alternatives: originals })];
  } });
  const relation = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(relation.kind, "resolved", "the actual native input-place relation is available first");
  const subject = Object.freeze({ kind: "value", node: selected.place.node, projection: [] });
  const firstSource = Object.freeze({ kind: "value", node: {}, projection: [] });
  const secondSource = Object.freeze({ kind: "value", node: {}, projection: [] });
  const queried = [];
  const storage = {
    subjectFor: node => {
      assert.equal(node === selected.place.node, true, "the selected original input node is queried");
      return { kind: "resolved", subject };
    },
    boundActivationsFor: () => { throw new Error("The completed source-origin alternatives must not be rebuilt."); },
    boundOriginsFor: (selectedSubject, bindings) => {
      assert.equal(selectedSubject === subject, true, "the canonical checked source subject is retained");
      assert.equal(bindings === firstBindings || bindings === secondBindings, true, "an actual activation token is required");
      queried.push(bindings);
      return { kind: "resolved", subjects: [bindings === firstBindings ? firstSource : secondSource] };
    },
  };
  const result = selectRustResultLoanSources(relation, { storage, physicalEmissionContexts: selected.input.physicalEmissionContexts });
  assert.equal(result.kind, "resolved", "both real source activations remain distinct");
  assert.equal(result.alternatives.length, 2, "no first-activation selection");
  for (const [index, source] of [firstSource, secondSource].entries()) {
    const alternative = result.alternatives[index];
    assert.equal(alternative.origin === originals[index] && alternative.origin.activation === activations[index], true,
      `original activation ${index}`);
    assert.equal(alternative.bindings === activations[index].bindings, true, `original input token ${index}`);
    assert.equal(alternative.loans[0].origins[0].sources.length, 1, `no independently merged source set ${index}`);
    assert.equal(alternative.loans[0].origins[0].sources[0] === source, true, `the corresponding original source ${index}`);
    assert.equal(alternative.loans[0].origins[0].native === relation.loans[0].origins[0], true,
      `the same native input/place relation ${index}`);
  }
  assert.equal(queried.length, 2, "one source query per original input and activation");
  assert.equal(queried[0] === firstBindings && queried[1] === secondBindings, true, "each source query keeps its actual binding token");
});

test("missing actual activation bindings remain unavailable without a declaration or empty fallback", () => {
  const selected = fixture({ originsForOccurrence: (use, occurrence) => [Object.freeze({
    kind: "unavailable", use, occurrence, reason: "The supplied source-binding token belongs to another query.",
  })] });
  const relation = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(relation.kind, "resolved", "native relation available independently of source activation");
  let origins = 0;
  const input = { physicalEmissionContexts: selected.input.physicalEmissionContexts, storage: {
    subjectFor: () => { throw new Error("No source input is queried after unavailable occurrence provenance."); },
    boundActivationsFor: () => { throw new Error("The completed source-origin alternatives must not be rebuilt."); },
    boundOriginsFor: () => { origins += 1; throw new Error("No fallback binding is admissible."); } } };
  const result = selectRustResultLoanSources(relation, input);
  assert.equal(result.kind, "unavailable", "foreign original bindings cannot be replaced");
  assert.equal(result.reasons[0], "The supplied source-binding token belongs to another query.", "the actual missing input remains explicit");
  assert.equal(origins, 0, "no query runs on invented or declaration-scope bindings");
});

for (const kind of ["callable", "declaration", "construction", "module"]) {
  test(`native returned-loan ${kind} origins retain the exact per-alternative input token`, () => {
    const firstBindings = Object.freeze({ substitutions: [] });
    const secondBindings = Object.freeze({ substitutions: [] });
    const normalizedActivationBindings = Object.freeze({ substitutions: [] });
    const targetBindings = Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
    let originalAlternatives;
    const selected = fixture({ originsForOccurrence: (use, occurrence, declaration) => {
      originalAlternatives = Object.freeze([firstBindings, secondBindings].map(bindings => {
        const activation = Object.freeze({ kind: "declaration", declaration, bindings });
        if (kind === "declaration") return Object.freeze({ kind, activation, targetBindings });
        if (kind === "callable") return Object.freeze({ kind, activation, targetBindings,
          producer: Object.freeze({}), member: Object.freeze({}), execution: Object.freeze({}) });
        if (kind === "construction") return Object.freeze({ kind,
          activation: Object.freeze({ ...activation, bindings: normalizedActivationBindings }), targetBindings,
          invocation: {}, construction: Object.freeze({}), owner: declaration, region: declaration,
          selection: Object.freeze({ kind: "resolved", bindings }) });
        return Object.freeze({ kind, targetBindings, sourceFile: {}, initializer: Object.freeze({}),
          module: Object.freeze({}), region: declaration, selection: Object.freeze({ kind: "resolved", bindings }) });
      }));
      return [Object.freeze({ kind: "resolved", use, occurrence,
        subject: Object.freeze({ kind: "value", node: occurrence.node, projection: [] }), alternatives: originalAlternatives })];
    } });
    const relation = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
    assert.equal(relation.kind, "resolved", `${kind}: declared place relation`);
    const subject = Object.freeze({ kind: "value", node: selected.place.node, projection: [] });
    const sources = [Object.freeze({ kind: "value", node: {}, projection: [] }),
      Object.freeze({ kind: "value", node: {}, projection: [] })];
    const queries = [];
    const result = selectRustResultLoanSources(relation, {
      physicalEmissionContexts: selected.input.physicalEmissionContexts,
      storage: {
        subjectFor: node => {
          assert.equal(node === selected.place.node, true, `${kind}: original input node`);
          return { kind: "resolved", subject };
        },
        boundActivationsFor: () => { throw new Error("Existing per-use source activations must not be recomputed."); },
        boundOriginsFor: (inputSubject, bindings) => {
          assert.equal(inputSubject === subject, true, `${kind}: original source subject`);
          assert.equal(bindings === firstBindings || bindings === secondBindings, true,
            `${kind}: never substitute a normalized activation, lexical default or target bindings for the original input token`);
          queries.push(bindings);
          return { kind: "resolved", subjects: [sources[bindings === firstBindings ? 0 : 1]] };
        },
      },
    });
    assert.equal(result.kind, "resolved", `${kind}: completed alternatives`);
    assert.equal(result.sourceOrigins === selected.context.sourceOrigins[0], true, `${kind}: original source record`);
    assert.equal(result.alternatives.length, 2, `${kind}: no first-row selection`);
    for (const [index, bindings] of [firstBindings, secondBindings].entries()) {
      const alternative = result.alternatives[index];
      assert.equal(alternative.origin === originalAlternatives[index], true, `${kind}: original alternative ${index}`);
      assert.equal(alternative.bindings === bindings, true, `${kind}: exact token ${index}`);
      assert.equal(alternative.loans[0].origins[0].sources[0] === sources[index], true,
        `${kind}: input/source correlation ${index}`);
    }
    assert.equal(queries.length, 2, `${kind}: one query per original input/alternative`);
  });
}

test("foreign or copied per-use source provenance cannot create an accepted native loan", () => {
  const selected = fixture({ originsForOccurrence: (use, occurrence, declaration) => [Object.freeze({
    kind: "resolved", use, occurrence, subject: Object.freeze({ kind: "value", node: occurrence.node, projection: [] }),
    alternatives: Object.freeze([Object.freeze({ kind: "declaration",
      activation: Object.freeze({ kind: "declaration", declaration, bindings: Object.freeze({ substitutions: [] }) }),
      targetBindings: Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() }) })]),
  })] });
  const relation = selectRustNativeResultPlaces(selected.node, selected.operation, selected.contextUse, selected.input);
  assert.equal(relation.kind, "resolved", "the original native relation remains independently available");
  const contexts = selected.input.physicalEmissionContexts;
  const canonical = selected.context.sourceOrigins[0];
  let getterReads = 0;
  const copied = Object.freeze({ ...canonical, get kind() { getterReads += 1; throw new Error("Copied metadata is never read."); } });
  for (const [label, row] of [["copied source row", copied], ["missing source row", undefined]]) {
    const result = selectRustResultLoanSources(relation, {
      physicalEmissionContexts: { ...contexts, sourceOriginFor: () => row },
      storage: { subjectFor: () => { throw new Error("No source query on foreign occurrence evidence."); } },
    });
    assert.equal(result.kind, "unavailable", label);
    assert.equal("alternatives" in result, false, `${label}: no fabricated empty result`);
  }
  assert.equal(getterReads, 0, "noncanonical source metadata is rejected before invoking its getters");
  assert.throws(() => selectRustResultLoanSources(relation, { substitutions: [] }, { storage: {} }), TypeError,
    "the removed caller-supplied binding API is not retained as an overload or fallback");
});
