import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRustGenericCallablePlan, rustFixedStructuralMethodDeclarations } from "../../../dist/analysis/callables/generic-values.js";
import { rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";


import { createRustGenericCallableFlowIndex } from "../../../dist/analysis/callables/generic-callable-flow.js";
import { rustGenericCallableConversionMatches } from "../../../dist/policy/conversions/generic-callable.js";
import { createRustCallableValuePlanRegistry } from "../../../dist/analysis/callables/value-plan.js";
import { createRustLexicalFunctionEnvironmentPlan } from "../../../dist/analysis/callables/lexical-functions.js";
import { createRustSourceCallableQueries } from "../../../dist/analysis/callables/borrowed-returns.js";
import { createRustRuntimeValueUsePlan } from "../../../dist/analysis/program/runtime-value-uses.js";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { emptyRustLifetimeIndex } from "../../../dist/target-model/lifetimes/index.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { createRustProjectTypePolicy } from "../../../dist/analysis/project-types/catalog/resolution.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { analyzeRustReceiverStorage } from "../../../dist/analysis/project-types/receiver-storage.js";
import { createRustObjectRepresentationPlan } from "../../../dist/analysis/project-types/object-representation.js";
import { createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/shapes/structural-shape-registry.js";
import { createRustRetainedEnvironmentQueries } from "../../../dist/analysis/callables/retained-environment-shapes.js";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";




import { rustSourceTypeCarrier, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";


import { fakeAstReader, fakeCompileInput, fakeSourcePackageGraph } from "../../helpers/fake-compile-input.mjs";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";

const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
function input() {
  const files = ["first", "second"].map(name => ({ name: `/${name}.ts`, nodes: [] }));
  const closures = files.map((file, index) => {
    const node = { file, position: index + 1, kindName: "KindArrowFunction" };
    node.carrier = rustGenericCallableTargetType([parameter], [parameter], parameter, {
      fileName: file.name, declarationIdentity: `${file.name}:1`,
    });
    file.nodes.push(node);
    return node;
  });
  const baseAst = fakeAstReader(files);
  const ast = {
    ...baseAst,
    is: { ...baseAst.is,
      IsCallSignatureDeclaration: node => node.kindName === "KindCallSignature",
      IsConstructSignatureDeclaration: node => node.kindName === "KindConstructSignature",
      IsPropertySignatureDeclaration: node => node.kindName === "KindPropertySignature",
      IsVariableDeclarationList: node => node.kindName === "KindVariableDeclarationList",
      IsEnumMember: node => node.kindName === "KindEnumMember",
    },
    typeParameters: node => node.typeParameters ?? [],
    forEachChild: (node, visit) => { for (const child of node.nodes ?? []) visit(child); },
    getSourceFile: node => node.file ?? node,
    getFileName: file => file.name,
    getPath: file => file.name,
    kind: () => 1,
    pos: node => node.position,
    end: node => node.position + 1,
    parent: node => node.file,
    as: {
      AsArrowFunction: node => node.kindName === "KindArrowFunction" ? { Body: baseAst.body(node) } : undefined,
      AsBinaryExpression: node => node.binary,
    },
  };
  // The plan reads the pre-seal participation that materialize() publishes through the same record builder.
  let participationRecords;
  const records = createRustRecordFixture({nativeParticipation: { get: node => participationRecords?.get(node) },
runtimeCarrier: { get: (node) => {
    if (node.carrier !== undefined)
        return { carrier: node.carrier };
    if (!closures.includes(node))
        return undefined;
    return undefined;
} },
targetOperation: { get: (node) => {
    if (node.operation !== undefined)
        return node.operation;
    if (!closures.includes(node))
        return undefined;
    return { kind: "closure", resultCarrier: node.carrier };
} },
objectLiteralMethodAdapter: { get: (node) => {
    return node.objectAdapters;
} },
projectCallableAdapters: { get: (node) => {
    return node.projectAdapters;
} },
receiverIndependentMethod: { get: (node) => {
    return node.independent;
} },
objectReferenceView: { get: (node) => {
    return node.referenceView;
} },
bindingProjection: { get: (node) => {
    return node.binding;
} },
contextualValueConversion: { get: (node) => {
    if (node.conversion !== undefined)
        return { conversion: node.conversion };
    if (!closures.includes(node))
        return undefined;
    return undefined;
} },
closureCapture: { get: (node) => {
    if (!closures.includes(node))
        return undefined;
    return { receivers: node.receivers ?? [], receiverFields: [], captures: node.captures ?? [] };
} }});
  const names = Object.freeze({ diagnostics: Object.freeze([]),
    nameForDeclaration: () => undefined,
    functionNameForDeclaration: () => undefined,
    callableValueNameForDeclaration: () => undefined,
    sourceScopeForDeclaration: () => undefined,
    scopeForDeclaration: () => undefined,
    nameForSourceType: () => undefined,
  });
  const navigation = { expressionValueFlow: node => ({ escapes: node === closures[1], identityCompared: false,
    hasUnclassifiedUse: false, captured: false }) };
  const source = fakeCompileInput({ sourceFiles: files }).source;
  const signatures = new Map(closures.map(declaration => [declaration, Object.freeze({ declaration })]));
  const semanticsForFile = file => ({ ...source.semantics.forFile(file), declarations: {
    declarationSignature(declaration) {
      assert.equal(signatures.has(declaration), true, "the logical fixture has only its two exact callable scopes");
      return signatures.get(declaration);
    },
    signatureParameters(signature) {
      assert.equal(signatures.get(signature.declaration) === signature, true,
        "a logical fixture scope uses its original signature identity");
      assert.equal(ast.parameters(signature.declaration).length, 0,
        "the logical family fixture supplies no native value formals");
      return [];
    },
  } });
  const currentSource = { ...source, ast, navigation: { ...source.navigation, ...navigation },
    semantics: { ...source.semantics, forFile: semanticsForFile,
      forNode: node => semanticsForFile(ast.getSourceFile(node)) } };
  const planInput = { ast, sourceFiles: files, sourcePackages: fakeSourcePackageGraph(
    files.map(file => ({ fileName: file.name })),
  ), records, names, navigation: currentSource.navigation, lifetimes: emptyRustLifetimeIndex,
    classValueAdapters: [], structuralViews: [], closedSourceFiles: new Set(),
    ownership: { components: [], activations: [], failureReason: () => undefined,
      instanceReceiverOwner(node) {
        assert.equal(files.some(file => file === node || file.nodes.includes(node)), true,
          "the virtual callable fixture has only file-owned declarations, never instance receivers");
        return undefined;
      } } };
  const materialize = () => {
    const sourceStorage = createSourceStorageQuery(currentSource, files);
    const builder = createRustProgramRecordBuilder();
    participationRecords = builder.nativeParticipations.records;
    const participation = analyzeRustNativeParticipation({ ast, storage: sourceStorage,
      navigation: currentSource.navigation, producer: builder.nativeParticipations, requiredRecords: [] });
    assert.equal(participation.kind, "resolved", "the current mutated fixture has one complete canonical native domain");
    const membership = new Set(participation.nodes);
    const isNativeNode = node => membership.has(node);
    const runtimeValueUses = createRustRuntimeValueUsePlan({ ast, navigation: currentSource.navigation,
      safetyApplications: { isCompileTimeApplicationReference: () => false } });
    const lexicalFunctions = createRustLexicalFunctionEnvironmentPlan(currentSource, participation.nodes, records,
      runtimeValueUses, createRustSourceCallableQueries(sourceStorage, new Set(), () => undefined));
    const typeDefinitions = createRustTypeDefinitionRegistry();
    const sourceTypes = createRustSourceTypeRegistry(undefined, typeDefinitions);
    const projectTypes = createRustProjectTypePolicy({ ast, names, navigation: currentSource.navigation,
      sourceFiles: files, sourceNodes: participation.nodes, isNativeNode,
      semanticsFor: currentSource.semantics.forNode, sourceLifetimes: emptyRustLifetimeIndex,
      collectImplicitInterfaces: () => [], thrownClassDeclarations: new Set(), sourceCreatedErrorOrigins: [],
      normalizeCarrier: carrier => carrier, isRepresentationAlias: () => false,
      genericParametersFor() { assert.fail("logical implementation fixtures contain no native class declarations"); },
      externallyExtensible() { assert.fail("logical implementation fixtures contain no extensible native classes"); },
      targetNameForCallable: names.functionNameForDeclaration,
      sourcePackageComponentForFile(file) {
        const selected = planInput.sourcePackages.packages.find(candidate => candidate.sourceFiles.includes(file));
        return selected === undefined ? undefined : planInput.sourcePackages.components.find(component =>
          component.packages.includes(selected.id))?.id;
      },
      resolveSelectedType() { assert.fail("logical implementation fixtures contain no native heritage"); },
      resolveExternalHeritage() { assert.fail("logical implementation fixtures contain no native external bases"); },
    }, () => {});
    assert.equal(projectTypes.definitions.length, 0, "logical carrier fixtures have no checked native class layouts");
    const receiverInput = { ast, navigation: currentSource.navigation, semantics: currentSource.semantics,
      sourceFiles: files, isNativeNode, projectTypes };
    const receiverStorage = analyzeRustReceiverStorage(receiverInput);
    const objectRepresentations = createRustObjectRepresentationPlan({ ...receiverInput, receiverStorage,
      valueWrites: new Set(), hasPromotedStorage: () => false, hasMutableStorageUse: () => false });
    const structuralShapes = createRustStructuralShapePlanRegistry();
    structuralShapes.initialize(sourceTypes.structuralObjects(), sourceTypes.structuralFieldImplementations(),
      () => "logical-callable-fixture", [], sourceTypes.structuralInstantiations(), new Map());
    const carrierHost = { sourceStorage, sourceTypes,
      projectFieldProjection() { assert.fail("logical carrier fixtures have no checked project-field projections"); },
      types: { resolveNode: node => records.runtimeCarrier.get(node)?.carrier },
      semantics: currentSource.semantics.forFile };
    const nativeTasks = { lifecycleOwner: undefined, spawns: [], owners: [], parameterOwners: new Set(), calls: [], entries: [] };
    const retainedEnvironments = createRustRetainedEnvironmentQueries({ source: currentSource, sourceStorage,
      sourceLifetimes: emptyRustLifetimeIndex, nativeTasks });
    return { ...planInput, sourceStorage, nativeNodes: participation.nodes,
      isNativeNode, lexicalFunctions, typeDefinitions, sourceTypes, projectTypes, objectRepresentations,
      structuralShapes, carrierHost, retainedEnvironments, nativeTasks,
      frozenDataWrites: { capturesFieldIdentity() { assert.fail("logical callable fixtures have no captured native class-field identities"); } } };
  };
  return { closures, planInput, materialize,
    create: (closed = new Set()) => {
      const current = materialize();
      return createRustGenericCallablePlan(ast, files, records, names,
        currentSource.navigation, current.isNativeNode,
        rustFixedStructuralMethodDeclarations(ast, current.structuralShapes), [], closed).plan;
    } };
}

function physicalLifecycleInputs({ beforeInitialize, afterInitialize }) {
  let registry;
  let input;
  let construction;
  let components;
  let preparationIssues;
  let selectionIssues;
  let sealInput;
  const { result } = compileRust({ files: { "index.ts": "export function value(value: number): number { return value; }" },
    compileTarget(request) {
      const context = analyzeRustCheckedContext(request, current => {
        const original = current.callableValues;
        registry = original;
        beforeInitialize(original);
        const callableValues = Object.create(original, {
          initialize: { value(selected) {
            input = selected;
            construction = original.initialize(selected);
            afterInitialize(original, construction);
            return construction;
          } },
          preparePhysicalStorage: { value(selected, effects, promiseBodies) {
            components = selected;
            preparationIssues = original.preparePhysicalStorage(selected, effects, promiseBodies);
            return preparationIssues;
          } },
          finalizeSelected: { value() {
            selectionIssues = original.finalizeSelected();
            return selectionIssues;
          } },
        });
        return { ...current, callableValues };
      });
      if (context.diagnostics.length === 0) {
        const completed = analyzeRustAnalysisProgram(request);
        assert.equal(completed.kind, "resolved",
          "the canonical complete analysis produces every required late sealing fact");
        const program = completed.value;
        assert.equal(program.source.ast === context.ast, true,
          "the complete native facts use the identical checked source reader");
        assert.equal(program.sourceFiles.length === context.sourceFiles.length &&
          program.sourceFiles.every((sourceFile, index) => sourceFile === context.sourceFiles[index]), true,
          "the late native facts retain every original checked SourceFile identity");
        assert.equal(context.projectTypes.definitions.length === 0 && program.projectTypes.definitions.length === 0, true,
          "the lifecycle fixture contains no foreign native class or constructor identities");
        sealInput = Object.freeze({ nativeGenerics: context.records.nativeGenericPlans,
          retainedCallableInputs: program.retainedCallableInputs,
          declarationGenericRequirements: program.declarationGenericRequirements,
          genericErrors: program.genericCallableErrors,
          errorRegions: program.errorRegions,
          initialization: program.errorRegions.initialization,
          constructions: program.projectTypes.definitions.map(definition => {
            const selected = program.projectConstructions.forDefinition(definition);
            assert.equal(selected !== undefined, true,
              "every completed native construction comes from its canonical producer");
            return selected;
          }) });
      }
      return context.diagnostics.length === 0 ? { kind: "resolved", value: { artifacts: [] }, diagnostics: [] }
        : { kind: "rejected", diagnostics: context.diagnostics };
    },
  });
  assert.equal(result.diagnostics.length, 0, "the complete checked lifecycle supplies its actual private construction inputs");
  assert.equal(registry !== undefined && input !== undefined && construction !== undefined && components !== undefined, true,
    "source effects and the one component classification precede physical storage preparation");
  assert.equal(preparationIssues?.length, 0, "all actual physical storage is prepared without issues");
  assert.equal(selectionIssues?.kind, "resolved", "source-selected families reach their complete admission result");
  assert.equal(selectionIssues.value.length, 0, "source-selected families finalize without issues");
  assert.equal(sealInput !== undefined, true, "the lifecycle uses actual completed native sealing inputs");
  return { registry, input, construction, components, sealInput };
}

test("callable value plans seal only after adapter classification and cannot be replaced", () => {
  const { registry, input: planInput, construction, components, sealInput } = physicalLifecycleInputs({
    beforeInitialize(current) {
      assert.throws(() => current.generic, /finalized after their selected adapters/u);
      assert.throws(() => current.issues, /finalized after their selected adapters/u);
      assert.throws(() => current.finalizeSelected(), /finalized after their selected adapters/u);
      assert.throws(() => current.selected, /selected physical families after effect analysis/u);
      assert.throws(() => current.seal(), /finalized after their selected adapters/u);
    },
    afterInitialize(current, selectedConstruction) {
      assert.equal(current.generic === selectedConstruction.generic, true, "construction has one identical generic family owner");
      assert.equal(current.issues.length, 0, "the actual complete construction has no issues");
      assert.equal(Object.isFrozen(selectedConstruction), true);
      assert.equal(current.frames === selectedConstruction.frames, true,
        "construction exposes the same raw frame inventory before effect analysis");
      assert.equal(Object.isFrozen(selectedConstruction.frames), true,
        "the raw frame plan has one frozen canonical identity");
      assert.equal(Object.isFrozen(selectedConstruction.frames.definitions), true,
        "raw frame definitions are immutable before physical error selection");
      assert.equal("suspended" in selectedConstruction || "initializePhysical" in selectedConstruction.generic, false,
        "construction exposes neither suspended inventories nor the private physical initializer");
      assert.throws(() => current.seal(), /Physical callable publication requires completed source-selected families and effects/u);
      assert.throws(() => current.publish(), /selected physical families after effect analysis/u);
      assert.throws(() => current.finalizeSelected(), /Physical callable families require their completed constructor and field storage selection/u);
    },
  });
  const selected = registry.selected;
  assert.throws(() => selected.genericCompletions, /Generic callable completions require sealed producer effects and component owners/u);
  registry.initializeCompletions({ ast: planInput.ast, sourceLifetimes: planInput.lifetimes,
    records: planInput.records, physical: registry.generic.physical, producers: registry.nativeProducers,
    definitions: planInput.typeDefinitions, components });
  const sealed = registry.seal(sealInput);
  assert.equal(sealed.kind, "resolved", "the original callable lifecycle seals using complete native facts");
  const plan = sealed.value;
  registry.publish();
  assert.equal(registry.selected === selected, true, "the finalized analysis selection cannot be replaced by publication");
  assert.equal(plan !== selected, true, "publication exposes the sealed data plan, not the private analysis selection");
  assert.equal(plan.generic === construction.generic, true, "sealed data retains the original family owner");
  assert.equal(plan.frames.definitions === construction.frames.definitions, true,
    "physical publication retains the original raw frame inventory instead of rebuilding it");
  assert.equal(plan.frames.entryErrors === construction.frames.entryErrors, true,
    "physical publication retains the one selected frame error owner");
  assert.equal("sealCounters" in plan.frames || "completeErrors" in plan.frames, false,
    "the published frame plan exposes no private construction authority");
  assert.equal(plan.frames.definitions.length, 0);
  assert.equal(Object.isFrozen(plan), true);
  assert.throws(() => registry.finalizeSelected(), /exactly once/u);
  assert.throws(() => registry.initialize(planInput), /only once/u);
});

for (const owner of ["class", "object", "project"]) {
  test(`callable ${owner} adapters participate in implementation closure before sealing`, () => {
    const { closures, planInput, materialize } = input();
    const adapter = { kind: "option-map", element: { kind: "option-some", element: {
      kind: "conversion", conversion: { kind: "generic-callable-flow", source: closures[0].carrier,
        target: closures[1].carrier },
    } } };
    const dispatch = { resultAdapter: { kind: "identity" }, parameterAdapters: [
      { kind: "rest", segments: [{ kind: "value", adapter }] },
    ] };
    if (owner === "class") planInput.classValueAdapters.push({ subject: closures[0], adapter });
    if (owner === "object") closures[0].objectAdapters = { dispatches: [dispatch] };
    if (owner === "project") closures[0].projectAdapters = [dispatch];
    const plan = createRustCallableValuePlanRegistry().initialize(materialize());
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.generic.definitions.length, 1);
    assert.equal(plan.generic.definitionFor(closures[0].carrier), plan.generic.definitionFor(closures[1].carrier));
    assert.equal(plan.generic.definitions[0].implementations.length, 2);
  });
}

test("unrelated equal-signature implementations do not acquire a common owner or storage policy", () => {
  const { closures, create } = input();
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 2);
  const first = plan.definitionFor(closures[0].carrier);
  const second = plan.definitionFor(closures[1].carrier);
  assert.notEqual(first.identity, second.identity);
  assert.deepEqual(first.implementations.map(value => value.declaration), [closures[0]]);
  assert.deepEqual(second.implementations.map(value => value.declaration), [closures[1]]);
  assert.equal(first.ownerFileName, "/first.ts");
  assert.equal(second.ownerFileName, "/second.ts");
  assert.equal(first.copy, true);
  assert.equal(first.implementations[0].storage, "value");
  assert.equal(second.copy, false);
  assert.equal(second.implementations[0].storage, "shared");
  assert.equal(plan.definitionFor(structuredClone(closures[0].carrier)), first);
});

test("only retained value-flow edges join otherwise independent callable contracts", () => {
  const { closures, create } = input();
  const conversion = { kind: "generic-callable-flow", source: closures[0].carrier, target: closures[1].carrier };
  assert.equal(rustGenericCallableConversionMatches(conversion, conversion.source, conversion.target), true);
  closures[0].conversion = conversion;
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitionFor(conversion.source), plan.definitionFor(conversion.target));
  assert.equal(plan.definitions[0].implementations.length, 2);
});

test("closed returned Copy environments stay inline unless selected operations observe their identity", () => {
  const { closures, planInput, create } = input();
  const closed = new Set(planInput.sourceFiles);
  assert.equal(create(closed).definitionFor(closures[1].carrier).copy, true);
  const comparison = { operation: { kind: "operator-token", operator: "==" },
    binary: { Left: { carrier: closures[1].carrier }, Right: { carrier: closures[1].carrier } } };
  planInput.sourceFiles[0].nodes.push(comparison);
  assert.equal(create(closed).definitionFor(closures[1].carrier).copy, false);
  assert.equal(create(closed).definitionFor(closures[0].carrier).copy, true);
});

test("provider transport and open exports cannot silently lose callable identity", () => {
  const { closures, planInput, create } = input();
  assert.equal(create().definitionFor(closures[1].carrier).copy, false);
  planInput.sourceFiles[0].nodes.push({ operation: { kind: "runtime-call", abi: {
    sourceArguments: [{ disposition: "runtime", carrier: closures[1].carrier }],
  } } });
  assert.equal(create(new Set(planInput.sourceFiles)).definitionFor(closures[1].carrier).copy, false);
  assert.equal(create(new Set(planInput.sourceFiles)).definitionFor(closures[0].carrier).copy, true);
});

test("generic callable flow closure is deterministic, transitive and fail-closed", () => {
  const { closures } = input();
  const first = closures[0].carrier;
  const second = closures[1].carrier;
  const third = rustGenericCallableTargetType([parameter], [parameter], parameter, { fileName: "/third.ts", declarationIdentity: "/third.ts:1" });
  const flow = (source, target) => ({ subject: closures[0], conversion: { kind: "generic-callable-flow", source, target } });
  const edges = [flow(first, second), flow(second, third), flow(third, first)];
  const forward = createRustGenericCallableFlowIndex(edges);
  const reverse = createRustGenericCallableFlowIndex([...edges].reverse());
  assert.deepEqual(forward.issues, []);
  for (const carrier of [first, second, third]) {
    assert.equal(forward.familyFor(carrier), forward.familyFor(first));
    assert.equal(reverse.familyFor(carrier), forward.familyFor(first));
  }
  const invalid = rustGenericCallableTargetType([parameter], [parameter], { kind: "source-primitive", name: "float64" }, first.value.origin);
  const rejected = createRustGenericCallableFlowIndex([flow(invalid, second)]);
  assert.equal(rejected.issues.length, 1);
  assert.notEqual(rejected.familyFor(first), rejected.familyFor(second));
  assert.equal(rustGenericCallableConversionMatches(edges[0].conversion, first, third), false);
});

test("implementations selected for one exact contextual contract share its native representation", () => {
  const { closures, create } = input();
  closures[1].carrier = closures[0].carrier;
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitions[0].implementations.length, 2);
  assert.equal(plan.definitions[0].copy, false);
  assert.equal(plan.definitions[0].identityObserved, true);
  assert.deepEqual(plan.definitions[0].implementations.map(value => value.storage), ["shared", "shared"]);
});

test("a non-Copy environment does not heap-allocate independent Copy variants", () => {
  const { closures, planInput, create } = input();
  closures[1].carrier = closures[0].carrier;
  closures[1].captures = [{ storage: "location", carrier: { kind: "source-primitive", name: "float64" } }];
  const plan = create(new Set(planInput.sourceFiles));
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions[0].copy, false);
  assert.equal(plan.definitions[0].identityObserved, false);
  assert.deepEqual(plan.definitions[0].implementations.map(value => value.storage), ["value", "shared"]);
  assert.equal(plan.implementationFor(closures[0]), plan.definitions[0].implementations[0]);
  const comparison = { operation: { kind: "operator-token", operator: "==" },
    binary: { Left: { carrier: closures[0].carrier }, Right: { carrier: closures[1].carrier } } };
  planInput.sourceFiles[0].nodes.push(comparison);
  const observed = create(new Set(planInput.sourceFiles));
  assert.equal(observed.definitions[0].identityObserved, true);
  assert.deepEqual(observed.definitions[0].implementations.map(value => value.storage), ["shared", "shared"]);
});

test("contradictory signatures under one origin fail closed instead of selecting another family", () => {
  const { closures, create } = input();
  closures[1].carrier = rustGenericCallableTargetType([parameter], [parameter], { kind: "source-primitive", name: "float64" }, closures[0].carrier.value.origin);
  const plan = create();
  assert.equal(plan.issues.length, 1);
  assert.match(plan.issues[0].message, /conflicting native signatures/u);
  assert.equal(plan.definitionFor(closures[1].carrier), undefined);
});

test("body-only generic captures keep one exact substituted environment owner", () => {
  const { closures, create } = input();
  const owner = { kind: "type-parameter", identity: "Outer", name: "Outer" };
  closures[0].carrier = rustGenericCallableTargetType([parameter], [parameter], parameter,
    closures[0].carrier.value.origin, [owner]);
  closures[0].captures = [{ declaration: {}, reference: {}, storage: "value", carrier: owner }];
  const plan = create();
  assert.equal(plan.issues.length, 0);
  const implementation = plan.implementationFor(closures[0]);
  assert.equal(implementation !== undefined, true);
  assert.equal(implementation.captures[0].storageCarrier.identity, "generic-callable:Environment:0");
  assert.deepEqual(implementation.substitutions, [["Outer", {
    kind: "type-parameter", identity: "generic-callable:Environment:0", name: "EnvironmentType0",
  }]]);
});

test("foreign body-only generic captures are rejected rather than erased from the owner", () => {
  const { closures, create } = input();
  const owner = { kind: "type-parameter", identity: "Outer", name: "Outer" };
  closures[0].carrier = rustGenericCallableTargetType([parameter], [parameter], parameter,
    closures[0].carrier.value.origin, [owner]);
  closures[0].captures = [{ declaration: {}, reference: {}, storage: "value",
    carrier: { kind: "type-parameter", identity: "Foreign", name: "Foreign" } }];
  const plan = create();
  assert.equal(plan.issues.length, 1);
  assert.match(plan.issues[0].message, /hidden existential captures/u);
  assert.equal(plan.implementationFor(closures[0]) === undefined, true);
});

test("whole native receiver captures retain their exact generic storage environment", () => {
  const { closures, create } = input();
  const ownerParameter = { kind: "type-parameter", identity: "Outer", name: "Outer" };
  const carrier = rustSourceTypeCarrier("/owner.ts", "Owner", "object", [{ kind: "type", type: ownerParameter }]);
  const reference = {};
  closures[0].carrier = rustGenericCallableTargetType([parameter], [parameter], parameter,
    closures[0].carrier.value.origin, [carrier]);
  closures[0].receivers = [{ owner: {}, reference, references: [reference], carrier }];
  const plan = create();
  assert.equal(plan.issues.length, 0);
  const implementation = plan.implementationFor(closures[0]);
  assert.equal(implementation !== undefined, true);
  assert.equal(implementation.receivers[0].storageCarrier.value.genericArguments[0].type.identity, "generic-callable:Environment:0");
  assert.equal(implementation.receivers[0].reference === reference, true);
});

test("whole receiver captures cannot introduce an undeclared foreign generic owner", () => {
  const { closures, create } = input();
  const ownerParameter = { kind: "type-parameter", identity: "Outer", name: "Outer" };
  const foreignParameter = { kind: "type-parameter", identity: "Foreign", name: "Foreign" };
  const carrier = rustSourceTypeCarrier("/owner.ts", "Owner", "object", [{ kind: "type", type: foreignParameter }]);
  const reference = {};
  closures[0].carrier = rustGenericCallableTargetType([parameter], [parameter], parameter,
    closures[0].carrier.value.origin, [ownerParameter]);
  closures[0].receivers = [{ owner: {}, reference, references: [reference], carrier }];
  const plan = create();
  assert.equal(plan.issues.length, 1);
  assert.match(plan.issues[0].message, /hidden existential captures/u);
  assert.equal(plan.implementationFor(closures[0]) === undefined, true);
});

test("receiver-independent methods retain their proven physical ABI without mutating source evidence", () => {
  const { closures, create } = input();
  const physical = closures[0].carrier;
  closures[0].carrier = rustGenericCallableTargetType([parameter], [{ kind: "source-primitive", name: "float64" }, parameter], parameter, physical.value.origin);
  closures[0].independent = { carrier: physical };
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.implementationFor(closures[0]).carrier, physical);
  assert.equal(plan.definitionFor(physical).signature.parameters.length, 1);
  assert.equal(plan.definitionFor(closures[0].carrier), undefined);
  assert.equal(closures[0].carrier.value.signature.parameters.length, 2);
});

test("an escaping receiver-independent method retains its own native identity family", () => {
  const { closures, create } = input();
  const physical = closures[1].carrier;
  closures[1].carrier = rustGenericCallableTargetType([parameter], [{ kind: "source-primitive", name: "float64" }, parameter], parameter, physical.value.origin);
  closures[1].independent = { carrier: physical };
  const plan = create();
  assert.deepEqual(plan.issues, []);
  const definition = plan.definitionFor(physical);
  assert.equal(definition.identityObserved, true);
  assert.equal(definition.copy, false);
  assert.equal(definition.implementations[0].storage, "shared");
});

for (const transport of ["spread", "reference", "rest"]) {
  for (const incompatible of [false, true]) {
    test(`generic field ${transport} transport ${incompatible ? "rejects contradictory contracts" : "retains exact implementation families"}`, () => {
      const { closures, planInput, materialize } = input();
      const source = closures[0].carrier;
      const target = incompatible ? rustGenericCallableTargetType([parameter], [parameter], { kind: "source-primitive", name: "float64" }, closures[1].carrier.value.origin) : closures[1].carrier;
      const shape = carrier => rustStructuralObjectTargetType("/first.ts", [{
        sourceName: "identity", type: carrier, presence: "required", readonly: false, method: true,
      }]);
      const node = {};
      if (transport === "spread") node.operation = { kind: "record-literal",
        contributions: [{ kind: "spread", sourceCarrier: shape(source), fields: [{ sourceStorageIndex: 0, targetStorageIndex: 0 }] }],
        fields: [{ storageIndex: 0, carrier: target }],
      };
      if (transport === "reference") node.referenceView = { kind: "structural", sourceCarrier: shape(source), targetCarrier: shape(target),
        fields: [{ destinationIndex: 0, source: { storageIndex: 0, resultCarrier: source } }],
      };
      if (transport === "rest") node.binding = { sourceCarrier: shape(source), bindingCarrier: shape(target),
        projection: { kind: "object-rest", fields: [{ sourceStorageIndex: 0, targetStorageIndex: 0 }] },
      };
      planInput.sourceFiles[0].nodes.push(node);
      const plan = createRustCallableValuePlanRegistry().initialize(materialize());
      assert.equal(plan.issues.length, incompatible ? 1 : 0);
      assert.equal(plan.generic.definitions.length, incompatible ? 2 : 1);
      if (incompatible) assert.match(plan.issues[0].message, /contradictory selected native signatures/u);
      else assert.equal(plan.generic.definitionFor(source), plan.generic.definitionFor(target));
    });
  }
}
