import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createTargetSourceProgram, Node_Initializer, sourceNodesOutsideErasedSubtrees } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createRustNativeCallableInputPlan } from "../../../dist/analysis/callables/native-inputs.js";
import { createRustNativeStorageQueries } from "../../../dist/analysis/callables/native-storage.js";
import { prepareRustProjectCallableFieldStorage } from "../../../dist/analysis/callables/project-field-storage.js";
import { finalizeRustNativeParameterStorage } from "../../../dist/analysis/callables/native-parameters.js";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustGenericCallablePlan, rustFixedStructuralMethodDeclarations } from "../../../dist/analysis/callables/generic-values.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native-captures.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";


import { rustOptionElementCarrier, rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph }
  from "../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";
import { createRustNativeStorageJoins } from "../../../dist/analysis/callables/native-storage-joins.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/shapes/structural-shape-plan.js";
import { rustStructuralGenericCarrier } from "../../../dist/policy/types/objects/structural-generics.js";
import { structuralStorageKey } from "../../../dist/policy/types/objects/structural-storage.js";
import { rustFutureTargetType } from "../../../dist/target-model/types/carriers/primitives.js";

test("physical demand uses initial layout kinds without reading completed method storage", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const callable = rustCallableTargetType([integer], integer);
  for (const kind of ["native-dispatch", "fixed", "stored", "Callable field", "Future field"]) {
    const method = kind === "native-dispatch" || kind === "fixed" || kind === "stored";
    const carrier = rustStructuralObjectTargetType("/source.ts", [{ sourceName: "read",
      type: kind === "Future field" ? rustFutureTargetType(integer) : callable,
      presence: "required", readonly: false, ...(method ? { method: true } : {}) }],
      "reference", kind === "native-dispatch" ? callable : undefined);
    const componentForFile = () => "source";
    const exposure = kind === "fixed" ? { kind: "fixed", declaration: {} } : { kind: "stored" };
    const key = structuralStorageKey(rustStructuralGenericCarrier(carrier, "fields").carrier, componentForFile);
    const registry = createRustStructuralShapePlanRegistry();
    registry.initialize([{ carrier }], [], componentForFile, [], [], new Map(method ? [[`${key}#0`, exposure]] : []));
    assert.throws(() => registry.completed, /completed/u, `${kind}: method payload publication is still unavailable`);
    if (method) assert.equal(registry.field(carrier, 0).methodPlan.kind, kind,
      `${kind}: the initial native layout owns the method classification`);
    const selected = createRustNativeStorageJoins({
      input: { storage: { subject() { assert.fail(`${kind}: classification must not project source storage`); } },
        definitions: emptyRustTypeDefinitions, structuralShapes: registry, producerErrorFor: () => undefined },
      boundaries: [], joinWrites: new Map(), step: () => true,
      fail(message) { assert.fail(`${kind}: ${message}`); },
    });
    assert.equal(selected.requiresPhysicalSelection(carrier, 0), kind !== "native-dispatch",
      `${kind}: only actual physical payloads need producer selection`);
    assert.throws(() => registry.completed, /completed/u, `${kind}: demand does not complete method payloads`);
  }
});

test("physical demand validates every nested layout even after finding a stored callable", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const callable = rustCallableTargetType([], integer);
  const missing = rustStructuralObjectTargetType("/foreign.ts", []);
  let reason;
  let projections = 0;
  const registry = createRustStructuralShapePlanRegistry();
  registry.initialize([], [], () => "source", [], [], new Map());
  const selected = createRustNativeStorageJoins({
    input: { storage: { subject() { projections += 1; assert.fail("invalid layout cannot reach source projection"); } },
      definitions: emptyRustTypeDefinitions, structuralShapes: registry, producerErrorFor: () => undefined },
    boundaries: [], joinWrites: new Map(), step: () => true,
    fail(message) { reason = message; return undefined; },
  });
  for (const [label, nested] of [
    ["array", { kind: "array", element: missing }],
    ["slice", { kind: "slice", element: missing }],
    ["tuple", { kind: "tuple", elements: [missing] }],
    ["reference", { kind: "reference", referent: missing, mutable: false }],
    ["optional", rustOptionTargetType(missing)],
  ]) {
    reason = undefined;
    assert.equal(selected.requiresPhysicalSelection({ kind: "tuple", elements: [callable, nested] }, 0) === undefined, true,
      `${label}: an earlier true demand cannot hide an invalid layout`);
    assert.match(reason, /layout owner/u, `${label}: exact native layout refusal is preserved`);
  }
  assert.equal(projections, 0, "physical classification never enters source projection");
});

test("physical demand keeps shared sibling payloads independent of canonical physical boundaries", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const callable = rustCallableTargetType([], integer);
  const equalCallable = rustCallableTargetType([], integer);
  assert.equal(callable !== equalCallable && rustTargetTypeRefEquals(callable, equalCallable), true,
    "the controls differ only in metadata object sharing, never native invocation contracts");
  const physical = rustStructuralObjectTargetType("/source.ts", [
    { sourceName: "read", type: rustCallableTargetType([], integer), presence: "required", readonly: false, method: true },
    { sourceName: "stored", type: callable, presence: "required", readonly: false },
  ], "reference", undefined, [], { kind: "physical",
    methods: [{ sourceName: "read", identity: "source:read", genericArguments: [] }] });
  const shape = rustStructuralObjectCarrierValue(physical);
  assert.equal(shape?.implementation?.kind, "physical", "the fixture uses a valid physical structural carrier");
  const definition = Object.freeze({ carrier: physical, fields: Object.freeze(shape.fields.map(field => Object.freeze({
    ...field, carrier: field.type, targetName: field.sourceName, storage: "stored",
    ...(field.method !== true ? {} : { methodPlan: Object.freeze({ kind: "fixed", carrier: field.type }) }),
  }))) });
  let reason;
  const selected = createRustNativeStorageJoins({
    input: { storage: { subject() { assert.fail("demand cannot project source storage"); } },
      definitions: emptyRustTypeDefinitions, producerErrorFor: () => undefined,
      structuralShapes: {
        definitionForCarrier: carrier => carrier === physical ? definition : undefined,
        field: (carrier, index) => carrier === physical ? definition.fields[index] : undefined,
      } },
    boundaries: [], joinWrites: new Map(), step: depth => depth <= 128,
    fail(message) { reason = message; return undefined; },
  });
  assert.equal(selected.requiresPhysicalSelection(physical, 0), false,
    "the exact admitted physical carrier does not reconstruct its stored payload");
  assert.equal(definition.carrier === physical, true, "the physical boundary preserves canonical identity");
  for (const [label, sibling] of [["shared", callable], ["metadata-equal", equalCallable]]) {
    const tuple = { kind: "tuple", elements: [physical, sibling] };
    for (const [wrapper, carrier] of [["tuple", tuple], ["array", { kind: "array", element: tuple }]])
      assert.equal(selected.requiresPhysicalSelection(carrier, 0), true,
        `${label}/${wrapper}: the sibling outside the physical owner retains its actual demand`);
  }
  const active = new Set();
  const foreign = rustStructuralObjectTargetType("/foreign.ts", shape.fields, shape.representation, undefined, [], shape.implementation);
  assert.equal(selected.requiresPhysicalSelection({ kind: "tuple", elements: [physical, callable, foreign] }, 0, active) === undefined, true,
    "a true sibling does not hide a foreign physical layout");
  assert.match(reason, /layout owner/u, "foreign physical storage retains the owning refusal");
  assert.equal(active.size, 0, "every failure releases the entire active recursion path");
});

test("physical demand terminates cyclic paths without erasing sibling demand or finite budgets", () => {
  const callable = rustCallableTargetType([], rustSourcePrimitiveTargetType("int32"));
  const cyclic = { kind: "tuple", elements: [] };
  cyclic.elements.push(cyclic, callable);
  let steps = 0;
  let remaining = 16;
  const selected = createRustNativeStorageJoins({
    input: { storage: {}, definitions: emptyRustTypeDefinitions, producerErrorFor: () => undefined,
      structuralShapes: {
        definitionForCarrier() { assert.fail("a tuple cycle is not structural storage"); },
        field() { assert.fail("a tuple cycle has no structural fields"); },
      } },
    boundaries: [], joinWrites: new Map(), step: depth => { steps += 1; return remaining-- > 0 && depth <= 128; },
    fail(message) { assert.fail(message); },
  });
  const active = new Set();
  assert.equal(selected.requiresPhysicalSelection(cyclic, 0, active), true,
    "a repeated ancestor does not suppress the separate real callable payload");
  assert.equal(steps, 3, "the cyclic path terminates at its repeated ancestor");
  assert.equal(active.size, 0, "successful traversal releases its active path");
  remaining = 1;
  assert.equal(selected.requiresPhysicalSelection(cyclic, 0, active) === undefined, true,
    "budget exhaustion remains unresolved, never a physical identity");
  assert.equal(active.size, 0, "budget failure releases its active path");
});

test("native callback signatures do not masquerade as stored aggregate payloads", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const callback = rustCallableTargetType([integer], integer);
  const selected = createRustNativeStorageJoins({
    input: { storage: {}, definitions: emptyRustTypeDefinitions,
      structuralShapes: { field() { throw new Error("A native call signature owns no structural storage fields."); } },
      producerErrorFor: () => undefined },
    boundaries: [], joinWrites: new Map(), step: () => true,
    fail(message) { throw new Error(message); },
  });
  for (const callTrait of ["Fn", "FnMut", "FnOnce"]) {
    for (const [name, args, result] of [["input", [callback], integer], ["output", [], callback], ["both", [callback], callback]]) {
      const carrier = { kind: "closure", callTrait, args, result };
      assert.equal(selected.requiresPhysicalSelection(carrier, 0), false,
        `${callTrait} ${name}: callback ABI metadata is not a captured aggregate storage slot`);
      assert.equal(carrier.args === args && carrier.result === result, true,
        `${callTrait} ${name}: the exact native argument and result contracts remain unchanged`);
    }
  }
  assert.equal(selected.requiresPhysicalSelection({ kind: "function-pointer", args: [callback], result: callback }, 0), false,
    "a native function pointer keeps the same signature-only storage rule");
  for (const carrier of [{ kind: "array", element: callback }, { kind: "tuple", elements: [callback] }]) {
    assert.equal(selected.requiresPhysicalSelection(carrier, 0), true,
      "actual aggregate callback payloads still require their physical stored-producer owner");
  }
});

function fixture(text, options = {}) {
  const { program, source: checked, operationAttempts } = analyzeRust({ surfaces: [], files: { "index.ts": text },
    ...options, captureOperationAttempts: true });
  const checkedSource = createTargetSourceProgram(checked);
  const guardedAst = Proxy.revocable(checkedSource.ast, {});
  const source = { ...checkedSource, ast: guardedAst.proxy };
  const storage = createSourceStorageQuery(source, program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile));
  const participation = sourceNodesOutsideErasedSubtrees(source.ast, storage.nodes,
    node => program.records.nativeParticipation.get(node) === "erased");
  assert.equal(participation.kind, "resolved", "the checked source has complete native participation");
  const nativeNodes = participation.nodes;
  const nativeNodeSet = new Set(nativeNodes);
  const genericRegistry = createRustGenericCallablePlan(source.ast, program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile), program.records, program.names, source.navigation,
    node => nativeNodeSet.has(node), rustFixedStructuralMethodDeclarations(source.ast, program.structuralShapes));
  const generic = genericRegistry.plan;
  let physical;
  const input = { source, ast: source.ast, storage, nativeNodes, records: program.records, definitions: program.typeDefinitions,
    operationAttempts,
    frames: program.callableValues.frames,
    capturesFor: declaration => captures.forDeclaration(declaration),
    structuralShapes: program.structuralShapes, projectTypes: program.projectTypes,
    generic, lexicalFunctions: program.lexicalFunctions, lifetimes: program.sourceLifetimes,
    physicalCarrierFor: (carrier, ownerFileName, subject, bindings, producers) =>
      physical.carrierFor(carrier, ownerFileName, subject, bindings, producers) };
  const genericImplementations = new Set(generic.definitions.flatMap(definition => definition.implementations.map(implementation => implementation.declaration)));
  const native = createRustNativeCallableInputPlan({ ...input, sourcePackages: program.host.sourcePackages, usedNames: new Set(),
    ownedRetainedParameter: program.callableValues.native.isNativeRetainedParameter,
    declaresGenericInputs: owner => source.ast.is.IsFunctionDeclaration(owner) || source.ast.is.IsMethodDeclaration(owner) ||
      source.ast.is.IsConstructorDeclaration(owner) || source.ast.is.IsGetAccessorDeclaration(owner) ||
      source.ast.is.IsSetAccessorDeclaration(owner) || genericImplementations.has(owner) ||
      program.lexicalFunctions.forDeclaration(owner)?.kind === "resolved" });
  const producers = createRustNativeCallableProducerPlan({ ...input, native, nodes: nativeNodes,
    returnCarrierFor: declaration => {
      const selected = queries.prepareReturn(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  producers.selectConstructionErrors(new Map());
  input.producers = producers;
  const guardedQueries = Proxy.revocable(createRustNativeStorageQueries({ ...input, native }), {});
  const queries = guardedQueries.proxy;
  const captures = createRustNativeCapturePlan({ ...input, nativeStorage: queries });
  physical = genericRegistry.initializePhysical({ ...input, native, captures,
    genericBindingsFor: queries.genericBindingsFor,
    boundSubjectFor: (subject, carrier, bindings) => queries.boundSubjectFor(subject, carrier, bindings) });
  const plan = finalizeRustNativeParameterStorage(input, queries);
  const declaration = name => storage.nodes.find(node => source.ast.name(node) !== undefined &&
    source.ast.text(source.ast.name(node)) === name &&
    (source.ast.is.IsFunctionDeclaration(node) || source.ast.is.IsVariableDeclaration(node) ||
      source.ast.is.IsPropertySignatureDeclaration(node)));
  const initializer = name => Node_Initializer(source.ast, declaration(name));
  const exactSubject = (node, kind, projection) => {
    const selected = kind === undefined ? storage.subjectFor(node) : storage.subject(node, kind, projection);
    assert.equal(selected.kind === "resolved", true, selected.reason ?? "owned storage subject");
    return selected.subject;
  };
  return { program, source, storage, input, native, plan, declaration, initializer, exactSubject,
    revokeSource: guardedAst.revoke, revokeQueries: guardedQueries.revoke };
}

for (const surfaces of [[], ["js"]]) {
  test(`optional callable literal state consumes its complete native interface field contract on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      interface Operation { label?: string; enabled?: boolean; callback?: () => number; run(): number; }
      export function absent(): Operation { return { run(): number { return 3; } }; }
      export function present(): Operation {
        return { label: "ready", enabled: false, callback: () => 7, run(): number { return 3; } };
      }
    ` } });
    const { ast } = program.source;
    const literals = [];
    const visit = node => {
      if (ast.is.IsObjectLiteralExpression(node)) literals.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(literals.length, 2, "omitted and present optional state both retain their original source literals");
    for (const literal of literals) {
      const selected = program.records.objectLiteralEmission.get(literal);
      assert.equal(selected?.kind, "project", "the nominal method record keeps its existing native interface representation");
      let callback;
      for (const field of selected.selection.fields) {
        const owner = program.projectTypes.definitionContainingDeclaration(field.declaration);
        const ownerCarrier = program.records.projectRelationship.get(selected.selection.carrier, owner);
        const physical = program.records.projectClassFields.get(owner, ownerCarrier)
          .find(candidate => candidate.declaration === field.declaration);
        assert.equal(field.carrier === physical?.carrier, true,
          "literal state and native dispatch use one identical instantiated physical member carrier");
        if (ast.text(ast.name(field.declaration)) === "callback") callback = field;
      }
      assert.equal(callback !== undefined, true, "an omitted callback still owns its original optional state slot");
      const payload = rustOptionElementCarrier(callback.carrier);
      const protocol = rustCallableProtocol(payload);
      assert.equal(protocol !== undefined, true, "native absence wraps the complete physical callable storage");
      assert.equal(protocol.lifetime.kind, "static", "the lifetime-free owning native interface has no unnameable state lifetime");
      assert.equal(protocol.error !== undefined, true, "the original physical callable error channel is retained, not invented by rendering");
    }
  });
}

for (const genericParameters of [[], [{ kind: "lifetime" }]]) {
  test(`callable fields select their complete member storage (${genericParameters.length === 0 ? "owned" : "borrowed"})`, () => {
    const declaration = {};
    const unrequested = {};
    const definition = { genericParameters };
    const lifetime = { kind: "parameter", identity: "field:environment", name: "environment" };
    const integer = rustSourcePrimitiveTargetType("int32");
    const declared = rustCallableTargetType([integer], integer, lifetime);
    const physical = genericParameters.length === 0 ? rustCallableTargetType([integer], integer, { kind: "static" }) : declared;
    const subjects = new Map([declaration, unrequested].map(node => [node, { node, kind: "member", projection: [] }]));
    let queries = 0;
    let selections = 0;
    let open = true;
    const fields = prepareRustProjectCallableFieldStorage({
      ast: new Proxy({}, { get() { throw new Error("A field storage owner must query its complete member subject, not one initializer."); } }),
      records: { runtimeCarrier: { get: node => {
        assert.equal(open, true, "published field readers never read source carrier evidence");
        return subjects.has(node) ? { carrier: declared } : undefined;
      } } },
      storage: { subject(node, kind) {
        assert.equal(open && subjects.has(node), true, "the declared field owns all initializer and later assigned values");
        assert.equal(kind, "member", "field selection has one canonical source-storage subject");
        queries += 1;
        return { kind: "resolved", subject: subjects.get(node) };
      } },
      projectTypes: { definitions: [definition], objectLayoutForDefinition: owner =>
        owner === definition ? { fields: [{ declaration }, { declaration: unrequested }] } : undefined },
    }, (selected, carrier) => {
      assert.equal(open && subjects.get(selected.node) === selected && carrier === declared, true,
        "physical selection keeps the exact declared member correspondence");
      selections += 1;
      return { kind: "identity", carrier: physical };
    });
    const carrier = fields.get(declaration);
    const protocol = rustCallableProtocol(carrier);
    assert.equal(carrier === physical, true, "the field owner publishes the native selector's exact physical carrier without lifetime retagging");
    assert.equal(protocol !== undefined, true, "an uninitialized callable field still has a physical slot");
    assert.equal(protocol.lifetime.kind, genericParameters.length === 0 ? "static" : "parameter",
      "only an actually owning native class closes its field storage lifetime");
    assert.equal(fields.get(declaration) === carrier, true, "a completed physical field selection is stable");
    assert.equal(queries, 1, "one complete field domain is queried once");
    assert.equal(selections, 1, "one native storage owner selects the field once");
    assert.equal(fields.get({}) === undefined, true, "a foreign declaration is not a field storage subject");
    const sealed = fields.seal();
    assert.equal(sealed.kind, "resolved", "the complete callable member inventory closes before program publication");
    assert.equal(queries, 2, "the seal also materializes a field nobody requested during analysis");
    assert.equal(selections, 2, "every original declared callable field has one native selection");
    open = false;
    assert.equal(sealed.value.get(declaration) === carrier, true, "published readers are stable without analysis access");
    assert.equal(sealed.value.get(unrequested) !== undefined, true, "unrequested fields cannot become post-seal computations");
    assert.equal(fields.get(declaration) === carrier, true, "the private closed builder also performs only a lookup");
  });
}

test("unresolved callable member storage is rejected by its producer before publication", () => {
  const declaration = {};
  const definition = { genericParameters: [] };
  const integer = rustSourcePrimitiveTargetType("int32");
  const carrier = rustCallableTargetType([], integer);
  const fields = prepareRustProjectCallableFieldStorage({ ast: {},
    records: { runtimeCarrier: { get: node => node === declaration ? { carrier } : undefined } },
    storage: { subject: node => ({ kind: "resolved", subject: { node, kind: "member", projection: [] } }),
      failureReason: () => undefined },
    projectTypes: { definitions: [definition], objectLayoutForDefinition: () => ({ fields: [{ declaration }] }) },
  }, () => ({ kind: "unresolved", reason: "The complete native field storage has incompatible actual producer contracts." }));
  const selected = fields.seal();
  assert.equal(selected.kind, "rejected", "missing physical member evidence never crosses the seal");
  assert.equal(selected.diagnostics.length, 1, "the original field receives one producer rejection");
  assert.equal(selected.diagnostics[0].sourceNode === declaration, true, "the diagnostic preserves the checked field identity");
  assert.equal(selected.diagnostics[0].code, "RUST_CALLABLE_VALUE_NOT_CLOSED", "the existing native callable closure diagnostic is retained");
  assert.equal(selected.diagnostics[0].message,
    "The complete native field storage has incompatible actual producer contracts.", "the owning selection's reason is preserved exactly");
});

for (const [name, wrap, unwrap] of [
  ["optional", rustOptionTargetType, rustOptionElementCarrier],
  ["tuple", carrier => ({ kind: "tuple", elements: [carrier] }), carrier => carrier.elements[0]],
]) {
  test(`nested ${name} callable member storage is materialized and sealed through its actual field domain`, () => {
    for (const ownsStorage of [true, false]) {
      const declaration = {};
      const definition = { genericParameters: ownsStorage ? [] : [{ kind: "lifetime" }] };
      const integer = rustSourcePrimitiveTargetType("int32");
      const lifetime = { kind: "parameter", identity: "nested-field:environment", name: "environment" };
      const declared = wrap(rustCallableTargetType([integer], integer, lifetime));
      const physical = ownsStorage ? wrap(rustCallableTargetType([integer], integer, { kind: "static" })) : declared;
      let open = true;
      let calls = 0;
      const fields = prepareRustProjectCallableFieldStorage({ ast: {},
        records: { runtimeCarrier: { get: node => {
          assert.equal(open, true, "sealed readers never query the nested source field again");
          return node === declaration ? { carrier: declared } : undefined;
        } } },
        storage: { subject(node, kind) {
          assert.equal(node === declaration && kind === "member", true,
            "the complete field, not a guessed initializer or optional payload, owns the native selection");
          return { kind: "resolved", subject: { node, kind, projection: [] } };
        } },
        projectTypes: { definitions: [definition], objectLayoutForDefinition: () => ({ fields: [{ declaration }] }) },
      }, (_subject, carrier) => {
        calls += 1;
        assert.equal(carrier === declared, true, "the native storage selector receives the complete nested declared carrier");
        return { kind: "identity", carrier: physical };
      });
      const selected = fields.seal();
      assert.equal(selected.kind, "resolved", "every unrequested nested callable field closes before publication");
      open = false;
      const carrier = selected.value.get(declaration);
      assert.equal(carrier !== undefined, true, "nested callable storage is not skipped by a direct-callable-only guard");
      assert.equal(carrier === physical, true, "the entire selected nested carrier is published without rewriting its native lifetimes");
      assert.equal(rustCallableProtocol(unwrap(carrier))?.lifetime.kind, ownsStorage ? "static" : "parameter",
        "the enclosing native field owns storage or retains its actual authored lifetime");
      assert.equal(calls, 1, "one native field selection covers the entire nested shape");
      assert.equal(selected.value.get(declaration) === carrier, true, "the published nested result is an identical stored record");
    }
  });
}

test("finalized formal ABI storage is a stable owned lookup without caller carrier arbitration", () => {
  const current = fixture("export function read(value: number): number { return value; }");
  const owner = current.declaration("read");
  const parameter = current.source.ast.parameters(owner)[0];
  const selected = current.plan.parameterFor(parameter);
  assert.equal(selected.kind, "identity");
  assert.equal(selected.carrier === current.program.records.sourceParameterAbi.get(parameter).parameterCarrier, true);
  assert.equal(current.plan.parameterFor(parameter) === selected, true);
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(current.plan.parameterFor.length, 1, "the formal ABI owner supplies the carrier");
});

test("published concrete and retained parameter classifications never resume source queries", () => {
  const current = fixture("export function read(value: number): number { return value; }");
  const parameter = current.source.ast.parameters(current.declaration("read"))[0];
  const concrete = current.native.isConcreteCallableParameter(parameter);
  const retained = current.native.isNativeRetainedParameter(parameter);
  current.revokeSource();
  assert.equal(current.native.isConcreteCallableParameter(parameter), concrete,
    "concrete parameter classification is a sealed set lookup");
  assert.equal(current.native.isNativeRetainedParameter(parameter), retained,
    "retention classification cannot invoke a captured analysis query");
  const foreign = new Proxy({}, { get() { throw new Error("A published native parameter lookup cannot inspect foreign source."); } });
  assert.equal(current.native.isConcreteCallableParameter(foreign), false, "foreign parameters have no concrete participation");
  assert.equal(current.native.isNativeRetainedParameter(foreign), false, "foreign parameters have no retained participation");
});

test("finalized formal ABI storage never inspects revoked source or fabricates foreign parameters", () => {
  const current = fixture("export function read(value: number): number { return value; }");
  const owner = current.declaration("read");
  const parameter = current.source.ast.parameters(owner)[0];
  current.revokeSource();
  current.revokeQueries();
  const selected = current.plan.parameterFor(parameter);
  assert.equal(current.plan.parameterFor(parameter) === selected, true);
  assert.equal(selected.kind, "identity");
  const missing = current.plan.parameterFor(owner);
  assert.equal(missing.kind, "unresolved");
  assert.equal(current.plan.parameterFor({}) === missing, true);
  assert.equal(Object.isFrozen(missing), true);
});

test("physical return preparation publishes one exact selection without recomputing pure readers", () => {
  const current = fixture("export function read(value: boolean): boolean { return value; }");
  const owner = current.declaration("read");
  assert.equal(current.plan.returnFor(owner).kind, "unresolved", "an unprepared return lookup cannot select source evidence");
  const selected = current.plan.prepareReturn(owner);
  assert.equal(selected.kind, "identity", "the actual scalar return retains its canonical native carrier");
  assert.equal(Object.isFrozen(selected), true, "the prepared result is immutable");
  assert.equal(current.plan.returnFor(owner) === selected, true, "the pure reader returns the same selection object");
  assert.equal(current.plan.prepareReturn(owner) === selected, true, "a repeated request does not reselect storage");
  assert.equal("prepareReturn" in current.program.callableValues.nativeStorage, false,
    "the published program never exposes the open construction writer");
  current.revokeSource();
  current.revokeQueries();
  assert.equal(current.plan.returnFor(owner) === selected, true, "the reader never inspects revoked construction inputs");
  assert.equal(current.plan.prepareReturn(owner) === selected, true, "the completed writer never repeats source selection");
  assert.equal(current.plan.returnFor({}).kind, "unresolved", "a foreign lookup cannot acquire a physical return");
  assert.equal(current.plan.prepareReturn({}).kind, "unresolved", "a foreign request is rejected before source inspection");
});

test("closed native generic queries validate ownership without manufacturing unused activations", () => {
  const current = fixture("export function closed(): number { return 7; }");
  const declaration = current.declaration("closed");
  const selected = current.plan.genericBindingsFor(declaration, current.storage.emptyBindings);
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.bindings.types.size + selected.bindings.lifetimes.size + selected.bindings.consts.size, 0);
  assert.equal(current.plan.genericBindingsFor(declaration, { ...current.storage.emptyBindings }).kind, "unresolved",
    "an empty-looking fabricated scope cannot acquire ownership");
  assert.equal(current.plan.genericBindingsFor({ ...declaration }, current.storage.emptyBindings).kind, "unresolved",
    "an equal-looking declaration cannot acquire source identity");
});

function selected(value, implementation, label) {
  assert.equal(value.kind === "selected", true, value.reason ?? label);
  assert.equal(value.carrier === implementation, true, label);
  assert.equal(value.inputs.length, 1, label);
  assert.equal(value.inputs[0].implementation === implementation, true, label);
  assert.equal(Object.isFrozen(value) && Object.isFrozen(value.inputs), true, "immutable exact selection");
}

test("physical forwarding preserves distinct equal-signature inputs through aliases and return", () => {
  const current = fixture(`
    export function choose(left: () => number, right: () => number): () => number {
      const first = left; const second = right; return first;
    }
  `);
  const owner = current.declaration("choose");
  const inputs = current.native.inputsFor(owner);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].implementation !== inputs[1].implementation, true);
  for (const [index, name] of ["first", "second"].entries()) {
    selected(current.plan.valueFor(current.declaration(name)), inputs[index].implementation, name);
    selected(current.plan.valueFor(current.initializer(name)), inputs[index].implementation, `${name} expression`);
  }
  selected(current.plan.prepareReturn(owner), inputs[0].implementation, "annotated return retains physical input");
});

test("physical forwarding crosses package calls without a recipient error or concrete caller closure", () => {
  const source = `
    import { forwarded } from "@acme/forward";
    export class RootFailure extends Error { code = 11; }
    export function pair(left: () => number, right: () => number): () => number {
      const first = forwarded(left); const second = forwarded(right); return second;
    }
  `;
  const current = fixture(source, { surfaces: ["js"], sourcePackages: sourcePackageCallbackErrorGraph,
    files: { ...sourcePackageCallbackErrorFiles, "index.ts": source } });
  for (const name of ["retain", "forwarded"]) {
    const owner = current.declaration(name);
    selected(current.plan.prepareReturn(owner), current.native.inputsFor(owner)[0].implementation, `${name} local input`);
  }
  const owner = current.declaration("pair");
  const inputs = current.native.inputsFor(owner);
  for (const [index, name] of ["first", "second"].entries()) {
    selected(current.plan.valueFor(current.declaration(name)), inputs[index].implementation, name);
    selected(current.plan.invocationReturnFor(current.declaration("forwarded"), current.initializer(name)),
      inputs[index].implementation, `${name} exact invocation substitution`);
    const targetInput = current.native.inputsFor(current.declaration("forwarded"))[0];
    selected(current.plan.invocationInputFor(targetInput, current.initializer(name)),
      inputs[index].implementation, `${name} cross-package input substitution`);
    assert.equal(targetInput.protocol.identity !== inputs[index].protocol.identity, true,
      "input transport does not assert protocol identity across declarations");
  }
  selected(current.plan.prepareReturn(owner), inputs[1].implementation, "second remains independent");
  const wrong = current.plan.invocationReturnFor(current.declaration("retain"), current.initializer("first"));
  assert.equal(wrong.kind, "unresolved", "an unselected implementation cannot supply the call result");
});

test("invocation input forwarding binds exact callee inputs rather than caller signatures", () => {
  const current = fixture(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(left: () => number, right: () => number): number {
      const first = invoke(left); const second = invoke(right); return first + second;
    }
    export function concrete(): number { const supplied = invoke(() => 7); return supplied; }
  `);
  const callee = current.native.inputsFor(current.declaration("invoke"))[0];
  const inputs = current.native.inputsFor(current.declaration("forward"));
  for (const [index, name] of ["first", "second"].entries()) {
    const value = current.plan.invocationInputFor(callee, current.initializer(name));
    assert.equal(value.kind, "selected", value.reason);
    assert.equal(value.inputs.length, 1);
    assert.equal(value.inputs[0] === inputs[index], true, "exact caller input preserved");
    assert.equal(value.carrier.kind, "reference", "callee's nonretaining borrowed input ABI preserved");
    assert.equal(value.carrier.referent === inputs[index].implementation, true, name);
    assert.equal(value.carrier.mutable, callee.carrier.mutable);
    assert.equal(value.carrier.lifetime === callee.carrier.lifetime, true);
    assert.equal(inputs[index].protocol === callee.protocol, true, "identical native contracts reuse their canonical trait");
    assert.equal(inputs[index].implementation.identity !== callee.implementation.identity, true,
      "contract interning never merges distinct caller and callee input identities");
  }
  const supplied = current.plan.invocationInputFor(callee, current.initializer("supplied"));
  assert.equal(supplied.kind, "selected", "concrete producer has its sealed physical error channel");
  assert.equal(supplied.inputs.length, 0, "a concrete producer is never rebranded as a formal input");
  const produced = rustCallablePhysicalSignature(supplied.carrier.referent);
  assert.equal(produced !== undefined, true, "concrete producer has the canonical exact callable signature");
  const error = rustProducerErrorReference(produced.error);
  assert.equal(error.channel, "invoke");
  assert.equal(current.input.producers.forIdentity(error.identity).declaration ===
    current.source.ast.arguments(current.initializer("supplied"))[0], true);
  assert.equal(current.plan.invocationInputFor(inputs[0], current.initializer("first")).kind, "unresolved",
    "input must belong to the invocation's exact selected implementation");
  let getterReads = 0;
  const forged = Object.defineProperty({}, "owner", { get() { getterReads += 1; return callee.owner; } });
  assert.equal(current.plan.invocationInputFor(forged, current.initializer("first")).kind, "unresolved");
  assert.equal(current.plan.invocationInputFor({ ...callee }, current.initializer("first")).kind, "unresolved");
  assert.equal(getterReads, 0, "a forged input token cannot execute accessors");
});

test("invocation input forwarding applies exact selected generic arguments without changing logical contracts", () => {
  const current = fixture(`
    export function retain<Value>(callback: () => Value): () => Value { return callback; }
    export function invoke(callback: () => number): () => number { const output = retain(callback); return output; }
  `);
  const callee = current.native.inputsFor(current.declaration("retain"))[0];
  const caller = current.native.inputsFor(current.declaration("invoke"))[0];
  const logical = callee.carrier;
  selected(current.plan.invocationInputFor(callee, current.initializer("output")), caller.implementation,
    "instantiated selected input preserves physical caller identity");
  selected(current.plan.invocationReturnFor(callee.owner, current.initializer("output")), caller.implementation,
    "instantiated selected result preserves physical caller identity");
  assert.equal(callee.carrier === logical, true, "declaration-local logical signature is not specialized in place");
});

test("physical captured forwarding retains outer inputs without mistaking a new closure for them", () => {
  const current = fixture(`
    export function capture(left: () => number, right: () => number): () => () => number {
      return () => { const captured = right; return captured; };
    }
  `);
  const owner = current.declaration("capture");
  const inputs = current.native.inputsFor(owner);
  const closure = current.storage.nodes.find(node => current.source.ast.is.IsArrowFunction(node));
  selected(current.plan.valueFor(current.declaration("captured")), inputs[1].implementation, "captured exact outer input");
  selected(current.plan.prepareReturn(closure), inputs[1].implementation, "nested return retains capture binding");
  const outward = current.plan.prepareReturn(owner);
  assert.equal(outward.kind, "selected", "concrete closure retains a sealed producer-owned signature");
  const callable = rustCallablePhysicalSignature(outward.carrier);
  assert.equal(callable !== undefined, true, "returned closure has the canonical exact callable signature");
  assert.equal(callable.result === inputs[1].implementation, true,
    "returned captured callback retains its exact physical input, not a logical runtime signature");
});

test("physical member and array reads use exact projected owner identities", () => {
  const current = fixture(`
    interface Callback { (): number; }
    type Holder<Value> = { readonly callback: Value; };
    export function project(left: Holder<Callback>, right: Holder<Callback>, many: Callback[]): void {
      const first = left.callback; const second = right.callback; const element = many[0];
    }
  `);
  const owner = current.declaration("project");
  const parameters = current.source.ast.parameters(owner);
  const inputs = current.native.inputsFor(owner);
  assert.equal(inputs.length, 3, "the unretained inputs preserve three genuinely generic source input slots");
  for (const [index, name] of ["first", "second", "element"].entries()) {
    assert.equal(current.native.isConcreteCallableParameter(parameters[index]), false,
      `${name} is not a retained concrete parameter`);
    const input = inputs.find(value => value.subject.node === parameters[index]);
    assert.equal(input !== undefined, true, `${name} has exact projected input`);
    selected(current.plan.valueFor(current.declaration(name)), input.implementation, name);
    const subject = current.exactSubject(current.initializer(name));
    const carrier = current.program.records.runtimeCarrier.get(current.declaration(name)).carrier;
    selected(current.plan.subjectFor(subject, carrier, owner), input.implementation, `${name} public subject query`);
    assert.equal(input.subject.projection[0].kind, index === 2 ? "array-element" : "member");
    if (index !== 2) assert.equal(input.subject.projection[0].declaration === current.declaration("callback"), true);
  }
  assert.equal(inputs[0].implementation !== inputs[1].implementation, true, "field spelling is not owner identity");
});

test("native callable storage classification retains exact subjects and is a pure finalized lookup", () => {
  const current = fixture(`
    interface Reader { read: (value: number) => number; }
    function original(value: number): number { return value; }
    export function inspect(callback: (value: number) => number, reader: Reader): void {
      const generic = callback; const fixed = reader.read; const produced = original;
    }
  `);
  const owner = current.declaration("inspect");
  const generic = current.exactSubject(current.source.ast.parameters(owner)[0], "input");
  const fixedOrigins = current.native.originsForValue(current.initializer("fixed"));
  assert.equal(fixedOrigins.kind, "resolved", "the fixed read retains its actual declaration-local origin");
  assert.equal(fixedOrigins.inputs.length, 0, "the nominal field is not reified as an unrelated generic input");
  assert.equal(fixedOrigins.implementations.length, 1, "the fixed field retains one exact source storage subject");
  const fixed = fixedOrigins.implementations[0];
  assert.equal(fixed.projection[0].kind, "member", "the fixed slot keeps the full member projection");
  const physical = current.program.callableValues.nativeStorage.valueFor(current.declaration("fixed"));
  assert.equal(physical.kind, "selected", "the actual nominal field publishes its exact physical runtime Callable");
  assert.equal(physical.erased, true, "the existing runtime Callable preserves its transported invocation error");
  const logical = current.program.records.runtimeCarrier.get(current.declaration("fixed")).carrier;
  assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).error,
    rustCallableProtocol(logical).error), true, "selection keeps the fixed Callable's exact original error carrier");
  const genericPhysical = current.program.callableValues.nativeStorage.valueFor(current.declaration("generic"));
  assert.equal(genericPhysical.kind, "selected", "the genuine native input retains its exact implementation");
  assert.equal(genericPhysical.erased === true, false, "an associated-error native input is not a fixed erased Callable");
  assert.equal(current.program.callableValues.nativeStorage.valueFor(current.declaration("produced")).erased === true,
    false, "a source-native producer does not acquire the fixed runtime Callable's error classification");
  const foreign = { ...fixed };
  current.revokeSource();
  current.revokeQueries();
  assert.equal(current.native.isConcreteCallableStorage(generic), false,
    "a finalized admitted generic subject reads its precomputed false without source queries");
  assert.equal(current.native.isConcreteCallableStorage(fixed), true,
    "a finalized fixed field reads its precomputed true without source queries");
  assert.equal(current.native.isConcreteCallableStorage(foreign), undefined,
    "an equal-looking foreign subject cannot silently become a generic input");
  assert.equal(current.native.isConcreteCallableStorage({}), undefined,
    "a missing classification remains unknown rather than an invented generic fallback");
});

test("physical selection preserves optional topology and borrowed parameter lifetime", () => {
  const current = fixture(`
    export function maybe(callback: (() => number) | undefined): (() => number) | undefined {
      const optional = callback; return optional;
    }
    export function invoke(callback: () => number): number { return callback(); }
  `);
  const owner = current.declaration("maybe");
  const input = current.native.inputsFor(owner)[0];
  for (const value of [current.plan.prepareReturn(owner), current.plan.valueFor(current.declaration("optional"))]) {
    assert.equal(value.kind, "selected", value.reason);
    assert.equal(rustOptionElementCarrier(value.carrier) === input.implementation, true);
    assert.equal(value.carrier.kind, input.carrier.kind, "native option topology retained");
    assert.equal(value.carrier.sourceAbsence, input.carrier.sourceAbsence, "one native absence state retained");
    assert.equal(Object.isFrozen(value.carrier.genericArguments), true);
  }
  const borrowedOwner = current.declaration("invoke");
  const parameter = current.source.ast.parameters(borrowedOwner)[0];
  const abi = current.program.records.sourceParameterAbi.get(parameter);
  const borrowed = current.plan.subjectFor(current.exactSubject(parameter, "input"), abi.parameterCarrier, borrowedOwner);
  assert.equal(borrowed.kind, "selected", borrowed.reason);
  assert.equal(borrowed.carrier.kind, abi.parameterCarrier.kind);
  assert.equal(borrowed.carrier.referent === current.native.inputsFor(borrowedOwner)[0].implementation, true);
  assert.equal(borrowed.carrier.lifetime === abi.parameterCarrier.lifetime, true, "exact selected loan, not a recreated lifetime");
  assert.equal(borrowed.carrier.mutable, abi.parameterCarrier.mutable);
});

test("physical tuple and array transport reuses exact existing component inputs", () => {
  const current = fixture(`
    interface Callback { (): number; }
    export function tuple(callbacks: [Callback, Callback]): [Callback, Callback] {
      const left = callbacks[0]; const right = callbacks[1]; return callbacks;
    }
    export function array(callbacks: Callback[]): [Callback[]] {
      const item = callbacks[0]; return [callbacks];
    }
  `);
  const tuple = current.declaration("tuple");
  const members = current.native.inputsFor(tuple);
  const pair = current.plan.prepareReturn(tuple);
  assert.equal(pair.kind, "selected", pair.reason);
  assert.equal(pair.carrier.kind, "tuple");
  assert.equal(pair.inputs.length, 2);
  for (const [index, element] of pair.carrier.elements.entries()) {
    const member = members.find(input => input.subject.projection[0]?.kind === "tuple-element" &&
      input.subject.projection[0].index === index);
    assert.equal(member !== undefined && element === member.implementation, true, `tuple component ${index}`);
  }
  const array = current.declaration("array");
  const list = current.plan.prepareReturn(array);
  assert.equal(list.kind, "selected", list.reason);
  assert.equal(current.native.isConcreteCallableParameter(current.source.ast.parameters(array)[0]), false,
    "the tuple return keeps the array component genuinely generic rather than nominally retained");
  assert.equal(list.carrier.kind, "tuple");
  assert.equal(list.carrier.elements[0].kind, "array");
  assert.equal(list.carrier.elements[0].element === current.native.inputsFor(array)[0].implementation, true);
});

const projectedNativePrograms = [
  ["retained member and array", `
    interface Callback { (): number; }
    interface Holder<Value> { readonly callback: Value; }
    export function project(left: Holder<Callback>, right: Holder<Callback>, many: Callback[]): Callback {
      const first = left.callback; const second = right.callback; const element = many[0]; return second;
    }
  `],
  ["tuple and retained array", `
    interface Callback { (): number; }
    export function tuple(callbacks: [Callback, Callback]): [Callback, Callback] {
      const left = callbacks[0]; const right = callbacks[1]; return callbacks;
    }
    export function array(callbacks: Callback[]): Callback[] {
      const item = callbacks[0]; return callbacks;
    }
  `],
  ["fixed field and getter", `
    interface Reader { read: (value: number) => number; }
    class Owner { get read(): (value: number) => number { return value => value + 1; } }
    function apply(callback: (value: number) => number, value: number): number { return callback(value); }
    export function run(reader: Reader): number { return apply(new Owner().read, reader.read(2)); }
  `],
];

for (const surfaces of [[], ["js"]]) for (const [name, sourceText] of projectedNativePrograms) {
  test(`projected callable storage preserves the original ${name} in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": sourceText } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message.slice(0, 256)}`).join("\n"));
    assert.equal(result.artifacts.length > 0, true, "the complete original source reaches native emission");
    const program = result.program;
    const { ast } = program.source;
    const declaration = sourceName => program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
      ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === sourceName);
    if (name === "retained member and array") {
      const owner = declaration("project");
      assert.equal(program.callableValues.native.inputsFor(owner).length, 0,
        "the original owned return retains the real aggregate storage, not invented implementation parameters");
      for (const parameter of ast.parameters(owner)) {
        assert.equal(program.callableValues.native.isNativeRetainedParameter(parameter), true,
          "each original native-owned input retains its concrete physical storage");
      }
    } else if (name === "tuple and retained array") {
      const tuple = declaration("tuple");
      const inputs = program.callableValues.native.inputsFor(tuple);
      assert.equal(inputs.length, 2, "the original tuple carries both exact component implementations");
      assert.equal(inputs[0].subject !== inputs[1].subject, true,
        "equal signatures do not collapse the two original tuple positions");
      const array = declaration("array");
      assert.equal(program.callableValues.native.inputsFor(array).length, surfaces.length === 0 ? 0 : 1,
        "the original native-owned array and JS array retain their actual distinct ABI geometry");
    } else {
      assert.equal(program.callableValues.native.inputsFor(declaration("run")).length, 0,
        "a nominally fixed field never becomes an unrelated implementation type parameter");
      assert.equal(program.callableValues.native.inputsFor(declaration("apply")).length, 1,
        "an actual direct callable formal retains its separate exact native implementation");
      assert.match(rustSourceText(result), /pub fn run\(/u,
        "the original exported function retains its actual nongeneric native field ABI");
    }
    validateGeneratedProject(`projected-callable-original-${surfaces[0] ?? "native"}`, result.artifacts);
  });
}

test("physical generic callable forwarding retains its quantified contract", () => {
  const current = fixture(`
    interface Identity { <Value>(value: Value): Value; }
    export function retain(callback: Identity): Identity { const alias = callback; return alias; }
  `);
  const owner = current.declaration("retain");
  const input = current.native.inputsFor(owner)[0];
  assert.equal(input.protocol.signature.typeParameters.length, 1);
  selected(current.plan.prepareReturn(owner), input.implementation, "quantified identity preserved");
  selected(current.plan.valueFor(current.declaration("alias")), input.implementation, "generic alias physical identity");
});

test("concrete quantified producers retain the existing sealed family through aliases and returns", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    export function make(): Identity {
      const original = <Value>(value: Value): Value => value;
      const alias: Identity = original;
      return alias;
    }
  `);
  for (const value of [current.plan.prepareReturn(current.declaration("make")),
    current.plan.valueFor(current.declaration("original")), current.plan.valueFor(current.declaration("alias"))]) {
    assert.equal(value.kind, "selected", value.reason);
    const definition = current.input.generic.physical.definitionFor(value.carrier);
    const implementation = current.input.generic.implementationFor(current.initializer("original"));
    assert.equal(definition !== undefined && implementation !== undefined && definition.members.length === 1 &&
      definition.members[0].implementation === implementation, true,
      "only the exact existing producer family is retained");
  }
  const unavailable = createRustNativeStorageQueries({ ...current.input, native: current.native,
    physicalCarrierFor: () => undefined });
  assert.equal(unavailable.prepareReturn(current.declaration("make")).kind, "unresolved",
    "signature equality cannot substitute for a missing producer identity");
});

test("physical selection rejects ambiguous mutation alternatives and seals concrete producers", () => {
  const current = fixture(`
    export function choose(left: () => number, right: () => number): () => number {
      left = right; const selected = left; return selected;
    }
    export function create(): () => number { return () => 7; }
    export function concrete(): () => number { const supplied = create(); return supplied; }
  `);
  for (const result of [current.plan.prepareReturn(current.declaration("choose")),
    current.plan.valueFor(current.declaration("selected"))])
    assert.equal(result.kind, "unresolved", "no signature-based choice, closed error guess, or silent fallback");
  const created = current.plan.prepareReturn(current.declaration("create"));
  const returned = current.plan.invocationReturnFor(current.declaration("create"), current.initializer("supplied"));
  assert.equal(created.kind, "selected");
  assert.equal(returned.kind, "selected");
  assert.deepEqual(returned.carrier, created.carrier, "one exact producer survives the selected return boundary");
  const callable = rustCallablePhysicalSignature(created.carrier);
  assert.equal(callable !== undefined, true, "created closure has the canonical exact callable signature");
  assert.equal(rustProducerErrorReference(callable.error).channel, "invoke");
});

test("physical storage validates token ownership, exact contracts and finite projection budgets", () => {
  const source = `export function identity(callback: () => number): () => number { const alias = callback; return alias; }`;
  const current = fixture(source);
  const foreign = fixture(source);
  const owner = current.declaration("identity");
  const input = current.native.inputsFor(owner)[0];
  const subject = current.exactSubject(current.declaration("alias"));
  let getterReads = 0;
  const forged = Object.defineProperty({}, "node", { get() { getterReads += 1; return subject.node; } });
  for (const candidate of [forged, { ...subject }, foreign.exactSubject(foreign.declaration("alias"))])
    assert.equal(current.plan.subjectFor(candidate, input.carrier, owner).kind, "unresolved");
  assert.equal(getterReads, 0, "foreign shape cannot execute a getter");
  assert.equal(current.plan.prepareReturn(foreign.declaration("identity")).kind, "unresolved");
  assert.equal(current.plan.subjectFor(subject, input.carrier, foreign.declaration("identity")).kind, "unresolved");
  const mismatched = rustCallableTargetType([], rustSourcePrimitiveTargetType("bool"));
  assert.equal(current.plan.subjectFor(subject, mismatched, owner).kind, "unresolved", "equal arity cannot substitute a different signature");
  const otherPlan = createRustNativeStorageQueries({ ...current.input, native: foreign.native });
  assert.equal(otherPlan.prepareReturn(owner).kind, "unresolved", "another native plan cannot mint this graph's input identity");
  const limited = createRustNativeStorageQueries({ ...current.input, native: current.native, storage: {
    ...current.storage, boundValueFrontierFor() { return { kind: "resolved",
      frontier: Array(4097).fill({ kind: "origin", subject: input.subject, bindings: current.storage.emptyBindings }) }; },
  } });
  const rejected = limited.prepareReturn(owner);
  assert.equal(rejected.kind, "unresolved");
  assert.match(rejected.reason, /budget/u);
});

test("non-callable storage remains an exact identity without inspecting unrelated origins", () => {
  const current = fixture(`export function number(value: number): number { const selected = value; return selected; }`);
  let originQueries = 0;
  const plan = createRustNativeStorageQueries({ ...current.input, native: current.native, storage: {
    ...current.storage, boundOriginsFor() { originQueries += 1; throw new Error("non-callable origin scan"); },
    boundValueFrontierFor() { originQueries += 1; throw new Error("non-callable frontier scan"); },
  } });
  const owner = current.declaration("number");
  const value = plan.valueFor(current.declaration("selected"));
  assert.equal(value.kind, "identity");
  assert.equal(value.carrier === current.program.records.runtimeCarrier.get(current.declaration("selected")).carrier, true);
  assert.equal(plan.prepareReturn(owner).kind, "identity");
  assert.equal(originQueries, 0);
});

test("structural native dispatch signatures are not stored callable payloads and require exact field ownership", () => {
  const current = fixture(`
    interface Box { readonly value: number; }
    interface Factory { new(value: number): Box; accepts(value: number): boolean; }
    class Value implements Box {
      readonly value: number;
      constructor(value: number) { this.value = value; }
      static accepts(value: number): boolean { return value >= 0; }
    }
    export function run(): boolean {
      const selected: Factory = Value;
      return new selected(3).value === 3;
    }
  `);
  const value = current.declaration("selected");
  assert.equal(current.plan.valueFor(value).kind, "identity", "the native dispatch layout already owns its signatures");
  const carrier = current.program.records.runtimeCarrier.get(value).carrier;
  const shape = rustStructuralObjectCarrierValue(carrier);
  const method = current.program.structuralShapes.definitionForCarrier(carrier).fields.find(field => field.method === true);
  assert.equal(method.methodPlan.kind, "native-dispatch", "the single native owner publishes the actual dispatch contract");
  for (const [name, invalid] of [
    ["missing", rustStructuralObjectTargetType("/foreign.ts", shape.fields, shape.representation, shape.construction, shape.bases)],
    ["stored", rustStructuralObjectTargetType(shape.ownerFileName, shape.fields.map(field =>
      field.method === true ? { ...field, method: undefined } : field), shape.representation, shape.construction, shape.bases)],
    ["malformed-presence", rustStructuralObjectTargetType(shape.ownerFileName, shape.fields.map(field =>
      field.method === true ? { ...field, presence: "missing" } : field), shape.representation, shape.construction, shape.bases)],
  ]) {
    assert.equal(current.program.structuralShapes.definitionForCarrier(invalid), undefined,
      `${name}: no published native owner admits the forged layout`);
    const selected = current.plan.subjectFor(current.exactSubject(value), invalid, current.declaration("run"));
    assert.equal(selected.kind, "unresolved", name);
    assert.match(selected.reason, /layout owner/u, name);
    for (const [wrapper, nested] of [
      ["array", { kind: "array", element: invalid }],
      ["slice", { kind: "slice", element: invalid }],
      ["tuple", { kind: "tuple", elements: [invalid] }],
      ["tuple after callable", { kind: "tuple", elements: [rustCallableTargetType([], rustSourcePrimitiveTargetType("int32")), invalid] }],
      ["reference", { kind: "reference", referent: invalid, mutable: false }],
      ["optional", rustOptionTargetType(invalid)],
    ]) {
      const selection = current.plan.subjectFor(current.exactSubject(value), nested, current.declaration("run"));
      assert.equal(selection.kind, "unresolved", `${name}/${wrapper}: nesting cannot turn an invalid structural layout into identity`);
      assert.match(selection.reason, /layout owner/u, `${name}/${wrapper}: the exact structural owner retains its refusal`);
    }
  }
});

const nestedMethodStorageSource = `
  export function run(): number {
    const leaf = { read(value: number): number { return value; } };
    const nested = { inner: leaf };
    const elements = [leaf];
    const array = { items: elements };
    const tuple: [{ read(value: number): number; }, number] = [leaf, 3];
    const tupled = { pair: tuple };
    return nested.inner.read(array.items[0].read(tupled.pair[1]));
  }
`;

test("nested structural methods retain the canonical physical layout through stored arrays and tuples", () => {
  const current = fixture(nestedMethodStorageSource);
  const methodSlots = new Map();
  for (const definition of current.program.structuralShapes.instances) for (const field of definition.fields)
    if (field.method === true) methodSlots.set(field, field.methodPlan.carrier);
  const reads = [];
  const plan = createRustNativeStorageQueries({ ...current.input, native: current.native, structuralShapes: {
    ...current.input.structuralShapes,
    definitionForCarrier(carrier) {
      const selected = current.input.structuralShapes.definitionForCarrier(carrier);
      reads.push(selected);
      return selected;
    },
  } });
  for (const name of ["leaf", "nested", "elements", "array", "tuple", "tupled"]) {
    const declaration = current.declaration(name);
    const before = reads.length;
    const sourceCarrier = current.program.records.runtimeCarrier.get(declaration).carrier;
    const expected = current.program.callableValues.nativeStorage.valueFor(declaration);
    const selected = plan.valueFor(declaration);
    assert.equal(expected.kind !== "unresolved", true, `${name}: the canonical physical selection resolves`);
    assert.equal(selected.kind !== "unresolved", true, `${name}: the independently constructed native storage query resolves`);
    assert.equal(selected.kind, expected.kind, selected.reason ?? `${name} uses its existing native structural layout`);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, expected.carrier), true,
      `${name} reads the exact completed physical carrier rather than inventing an aggregate layout`);
    assert.equal(current.program.records.runtimeCarrier.get(declaration).carrier === sourceCarrier, true,
      `${name} preserves its distinct logical source carrier without a post-seal rewrite`);
    assert.equal(reads.length > before, true, `${name} consults its actual nested method layout`);
    assert.equal(Object.isFrozen(selected), true, `${name} has an immutable physical selection`);
  }
  for (const [field, carrier] of methodSlots) {
    assert.equal(carrier !== undefined, true, "every selected method has its canonical physical storage slot");
    assert.equal(field.methodPlan.carrier === carrier, true, "physical selection never rewrites the method storage carrier");
    assert.equal(Object.isFrozen(field), true, "the physical method field remains frozen");
  }
});

test("nested native method storage rejects missing layouts, slots and foreign source identities", () => {
  const current = fixture(nestedMethodStorageSource);
  const declaration = current.declaration("nested");
  const rootCarrier = current.program.records.runtimeCarrier.get(declaration).carrier;
  const leaf = current.declaration("leaf");
  const leafCarrier = current.program.callableValues.nativeStorage.valueFor(leaf).carrier;
  const leafShape = rustStructuralObjectCarrierValue(leafCarrier);
  for (const mode of ["missing-layout", "missing-slot", "unknown-method-role"]) {
    const invalid = rustStructuralObjectTargetType(mode === "missing-layout" ? "/foreign.ts" : leafShape.ownerFileName,
      mode === "missing-slot" ? leafShape.fields.filter(field => field.method !== true)
        : mode === "unknown-method-role" ? leafShape.fields.map(field => field.method === true ? { ...field, method: undefined } : field)
          : leafShape.fields, leafShape.representation, leafShape.construction, leafShape.bases, leafShape.implementation);
    assert.equal(current.program.structuralShapes.definitionForCarrier(invalid), undefined,
      `${mode} has no canonical nested physical owner`);
    const selected = current.plan.subjectFor(current.exactSubject(leaf), invalid, current.declaration("run"));
    assert.equal(selected.kind, "unresolved", `${mode} cannot prove a physical layout`);
    assert.match(selected.reason, /layout owner|valid selected carrier/u, `${mode} fails at its actual physical admission boundary`);
    assert.equal(rustTargetTypeRefEquals(leafCarrier, rootCarrier), false, `${mode} exercises the actual nested owner rather than the aggregate`);
    assert.equal(Object.isFrozen(selected), true, `${mode} preserves immutable unresolved evidence`);
  }
  const foreign = fixture(nestedMethodStorageSource);
  for (const node of [{}, { ...declaration }, foreign.declaration("nested")]) {
    const selected = current.plan.valueFor(node);
    assert.equal(selected.kind, "unresolved", "unknown or foreign nodes cannot acquire a physical aggregate layout");
    assert.equal(Object.isFrozen(selected), true, "unknown source selection remains immutable");
  }
  const foreignSubject = foreign.exactSubject(foreign.declaration("nested"));
  assert.equal(current.plan.subjectFor(foreignSubject, rootCarrier, current.declaration("run")).kind, "unresolved",
    "an equal-looking foreign aggregate subject cannot acquire the current graph's layout");
});

test("absent native callable values consume only their exact admitted invocation argument witnesses", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    import type { int64 } from "@tsonic/core/types.js";
    const wide: int64 = 9007199254740993n;
    function fail(): never { throw new Error("absent"); }
    function call(read: ((value: int64) => int64) | null | undefined): int64 { return (read ?? fail())(wide); }
    function relay(read: ((value: int64) => int64) | null | undefined): int64 { return call(read); }
    export function main(): void {
      if (relay(value => value) !== wide) throw new Error("wide result changed");
      let caught = 0;
      try { relay(null); } catch { caught++; }
      try { relay(undefined); } catch { caught++; }
      if (caught !== 2) throw new Error("native absence changed");
    }
    main();
  ` } });
  const { ast } = program.source;
  const storage = program.callableValues.nativeStorage;
  const witnessed = [];
  const visit = node => {
    if (ast.is.IsCallExpression(node)) for (const argument of ast.arguments(node)) {
      const witness = storage.invocationArgumentWitnessFor(node, argument);
      if (witness === undefined) continue;
      const selected = storage.valueFor(argument);
      assert.equal(selected.kind, "selected", "an absent argument has its already-admitted physical native selection");
      assert.equal(selected.carrier === witness, true, "the complete original invocation witness is retained by identity");
      assert.equal(selected.inputs.length, 0, "absence does not invent a callable parameter producer");
      assert.equal(selected.sources.length, 0, "absence does not invent a runtime callable source");
      assert.equal(Object.isFrozen(selected), true, "the selected absence contract is immutable");
      witnessed.push({ invocation: node, argument });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(witnessed.length, 2, "null and undefined keep one native absence at their two exact call sites");
  for (const [index, selected] of witnessed.entries()) {
    assert.equal(storage.invocationArgumentWitnessFor(witnessed[1 - index].invocation, selected.argument) === undefined, true,
      "a witness cannot cross an unrelated invocation even when its physical carrier matches");
  }
  assert.equal(storage.valueFor({}).kind, "unresolved", "a foreign source node cannot acquire an admitted native absence witness");
});

test("raw callable and Future data fields still require their own exact physical aggregate storage", () => {
  const current = fixture(`
    export function callableData(value: { stored: () => number }): number { return 1; }
    export function futureData(value: { stored: Promise<number> }): number { return 1; }
  `);
  for (const name of ["callableData", "futureData"]) {
    const owner = current.declaration(name);
    const parameter = current.source.ast.parameters(owner)[0];
    const selected = current.plan.parameterFor(parameter);
    assert.equal(selected.kind, "unresolved", `${name} cannot substitute method-signature readiness for stored data`);
    assert.match(selected.reason, /physical aggregate layout owner/u,
      `${name} retains the exact physical data-layout obligation`);
    assert.equal(Object.isFrozen(selected), true, `${name} preserves its immutable unresolved physical storage`);
  }
});
