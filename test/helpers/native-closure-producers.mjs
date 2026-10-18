import assert from "node:assert/strict";
import { analyzeRust } from "./rust-session.mjs";
import { createRustProviderPackage } from "../../dist/public/provider.js";

import { rustPackageFallibleBoundary } from "../../dist/backend/planner/program/fallible-boundaries.js";
import { createRustPlanningContext } from "../../dist/backend/planner/context.js";
import { materializeRustSourcePackageFacades } from "../../dist/backend/planner/program/source-package-facades.js";
import { planRustSourcePackageComponents } from "../../dist/backend/planner/program/source-package-components.js";
import { createRustSyntheticNameState } from "../../dist/backend/planner/names/synthetic.js";
import { planRustCallableExpressionBody } from "../../dist/backend/planner/expressions/callable.js";
import { printRustExpr } from "../../dist/print/source/expressions/core.js";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { createRustNativeCallableProducerPlan } from "../../dist/analysis/callables/native-producers.js";
import { normalizeRustErrorType } from "../../dist/analysis/errors/error-types.js";
import { rustCallableProtocol } from "../../dist/target-model/types/carriers/callables.js";
import { rustNativeFixtureNodes } from "./records.mjs";

export function nativeClosureProducerFixture({ asynchronous = false, surfaces = [], source, packages = [],
  selectRecords = records => records, selectProducers = value => value,
  selectEmissionContexts = contexts => contexts,
  body = () => ({ kind: "int-literal", text: "3" }),
} = {}) {
  const output = asynchronous ? "Promise<int32>" : "int32";
  const analyzed = analyzeRust({ surfaces, packages, files: { "index.ts": source ?? `
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => ${output} {
  return ${asynchronous ? "async " : ""}(): ${output} => { return 3; };
}
` } });
  const original = analyzed.program;
  const { ast } = original.source;
  const closures = [];
  const visit = node => {
    if (original.records.targetOperation.get(node)?.kind === "closure") closures.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  original.sourceFiles.forEach(visit);
  assert.equal(closures.length, 1, "one checked closure producer");
  const node = closures[0];
  const records = selectRecords(original.records, node);
  const owner = sourceEnclosingCallable(ast.parent(node), ast);
  assert.equal(owner !== undefined, true, "the fixture closure has its original checked lexical owner");
  let nativeProducers = original.callableValues.nativeProducers;
  if (records !== original.records) {
    const construction = createRustNativeCallableProducerPlan({ ast, records, nodes: rustNativeFixtureNodes(original),
      native: original.callableValues.native, definitions: original.typeDefinitions, structuralShapes: original.structuralShapes,
      returnCarrierFor(declaration) {
        const selected = original.callableValues.nativeStorage.returnFor(declaration);
        return selected.kind === "unresolved" ? undefined : selected.carrier;
      } });
    const errors = new Map();
    for (const producer of construction.producers) {
      const intrinsic = construction.errorFor(producer.declaration, "invoke");
      const selected = intrinsic === undefined ? undefined : normalizeRustErrorType(intrinsic, { ast, records,
        components: original.sourcePackageComponents, producers: construction, definitions: original.typeDefinitions }, producer.declaration);
      if (selected !== undefined) errors.set(producer.declaration, selected);
    }
    construction.selectConstructionErrors(errors);
    const context = original.physicalEmissionContexts.contextForOwner(owner, "native-body");
    assert.equal(context !== undefined, true, "the producer fixture retains its original emitted use context");
    const carrier = records.targetOperation.get(node)?.resultCarrier;
    const requests = rustCallableProtocol(carrier) === undefined ? [] : [Object.freeze({ kind: "producer", subject: node,
      declaration: node, owner, carrier, context: context.use, bindings: context.bindings })];
    const completed = construction.seal(Object.freeze(requests));
    assert.equal(completed.kind, "resolved", "the actual producer owner seals the selected fixture carrier before planning");
    nativeProducers = completed.value;
  }
  const program = { ...original, records, physicalEmissionContexts: selectEmissionContexts(original.physicalEmissionContexts, node),
    callableValues: { ...original.callableValues,
    nativeProducers: selectProducers(nativeProducers),
  } };
  const planning = createRustPlanningContext(program);
  const facades = materializeRustSourcePackageFacades(planning, program.sourceOutputIdentities);
  assert.equal(facades.diagnostics.length, 0, "the actual producer facade inputs are complete");
  assert.equal(facades.plan !== undefined, true, "the actual producer facade plan is admitted");
  const components = planRustSourcePackageComponents(planning, program.sourceOutputIdentities, facades.plan);
  assert.equal(components.kind, "accepted", "the actual producer source-package components are admitted");
  const sourcePackageErrors = program.errorTransport;
  assert.equal(sourcePackageErrors !== undefined, true, "the actual producer error domains are admitted");
  const sourceFile = ast.getSourceFile(node);
  const fileName = ast.getFileName(sourceFile);
  const identity = program.sourceOutputIdentities.get(fileName);
  const component = components.components.find(value => value.componentId === identity?.componentId);
  assert.equal(identity !== undefined && component !== undefined, true, "the producer has its exact native source identity");
  const bodyContexts = [];
  const emissionContext = program.physicalEmissionContexts.contextForOwner(owner, "native-body");
  assert.equal(emissionContext !== undefined, true, "the fixture uses its exact published enclosing native body");
  const context = {
    emissionContext,
    input: planning,
    sourceFile, sourcePackageComponentId: component.componentId, moduleName: identity.moduleName,
    moduleNameByFileName: new Map([...program.sourceOutputIdentities].map(([file, identity]) => [file, identity.moduleName])),
    externalCrateNameByFileName: new Map([...program.sourceOutputIdentities].flatMap(([file, identity]) =>
      identity.externalCrateName === undefined ? [] : [[file, identity.externalCrateName]])),
    externalItemPathByIdentity: facades.plan.externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName: new Map(),
    programModuleName: component.programModuleName, structuralShapesModuleName: component.structuralShapesModuleName,
    publicImplementationItemIdentities: component.publicImplementationItemIdentities,
    publishesImplementationAbi: component.publishesImplementationAbi,
    usedAliases: new Set(), diagnostics: [], syntheticNames: createRustSyntheticNameState(ast, node, []),
    sourcePackageErrors,
    fallibleBoundary: rustPackageFallibleBoundary({ componentId: "unrelated-consumer", errorDomain: "program",
      errorTypeIdentity: "unrelated:ConsumerFailure", errorTypePath: "ConsumerFailure",
    }),
    planBlock: (_block, bodyContext) => {
      bodyContexts.push(bodyContext);
      return { statements: [{ kind: "tail", expr: body(bodyContext) }] };
    },
  };
  return { node, program, original, context, bodyContexts,
    plan: () => planRustCallableExpressionBody(node, context),
  };
}

export function nativeClosureProducerFailurePackage(errorType, { path = "fail", parameters = [], result = "int32" } = {}) {
  const resultCarrier = { kind: "source-primitive", name: result };
  return createRustProviderPackage({
    id: "native-closure-producer-proof", version: "1.0.0", displayName: "Native closure producer proof",
    crates: [],
    modules: [{ moduleSpecifier: "test:producer", providerModuleId: "test.producer", exports: [{
      id: "test:producer::fail", name: "fail", kind: "function", signatures: [{
        id: "test:producer::fail()", name: "fail", parameters: parameters.map(parameter => ({
          name: parameter.name, type: { kind: "source-primitive", name: parameter.type },
        })), returnType: resultCarrier,
      }],
    }] }],
    operations: [{ exportId: "test:producer::fail", operationKind: "method",
      target: { form: "call", path }, parameterCarriers: parameters.map(parameter => ({ kind: "source-primitive", name: parameter.type })),
      resultCarrier, isFallible: true,
      errorBoundary: "provider-native", errorCarrier: errorType,
    }],
  });
}

export function planNativeClosureProducer(fixture) {
  const expression = fixture.plan();
  assert.equal(expression !== undefined, true,
    fixture.context.diagnostics.map(diagnostic => diagnostic.message).join("\n") || "closure producer exists");
  assert.equal(fixture.context.diagnostics.length, 0, "closure diagnostics");
  return expression;
}

export function printNativeClosureProducer(fixture) {
  return printRustExpr(planNativeClosureProducer(fixture));
}
