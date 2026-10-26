import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRustErrorRegions } from "../../../dist/analysis/errors/regions.js";
import { rustJsPromiseTargetType, rustJsValueTargetType, rustProgramErrorTargetType,
  rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustRuntimeErrorTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustNativeErrorJoinTargetType } from "../../../dist/target-model/types/native-error-joins.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { selectRustJsRejectionRegion } from "../../../dist/policy/operations/flow/js-rejection.js";

function selectRegion(nativeErrors, localErrors = false, asynchronous = true) {
  const fileName = "/src/index.ts";
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src",
    files: { [fileName]: "export function body(): number { return 1; }" },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the error-region owner receives checked source");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile(fileName);
  assert.equal(file !== undefined, true, "the original checked source file exists");
  const declaration = source.ast.statements(file).find(node => source.ast.is.IsFunctionDeclaration(node));
  assert.equal(declaration !== undefined, true, "the original checked callable declaration exists");
  const empty = Object.freeze({ get: () => undefined });
  const effects = Object.freeze({ localErrors, nativeErrors });
  const outputCarrier = rustSourcePrimitiveTargetType("int32");
  const result = analyzeRustErrorRegions({
    ast: source.ast,
    sourceFiles: [file],
    nativeTasks: [], binaryHooks: [],
    isNativeNode: node => node === file || node === declaration,
    promiseBodies: { declarations: new Map(asynchronous ? [[declaration, { name: "body" }]] : []),
      objects: new Map(asynchronous ? [[declaration, declaration]] : []) },
    records: { errorEffects: { get: node => node === declaration ? effects : undefined },
      asyncFunction: { get: node => asynchronous && node === declaration
        ? { kind: "js-promise", outputCarrier, futureCarrier: rustJsPromiseTargetType(outputCarrier),
          lowering: { kind: "settled", settledAwaits: [] } } : undefined },
      sourceCallableReturn: empty, sourceErrorEffects: empty, contextualValueConversion: empty,
      projectCallableAdapters: empty, targetOperation: empty },
    names: { nameForDeclaration: () => undefined, functionNameForDeclaration: () => undefined,
      callableValueNameForDeclaration: () => undefined },
    callables: { native: { inputs: [] }, nativeGenericProducers: { errorAritiesFor: () => [] },
      frames: { definitions: Object.freeze([]) } },
    producers: { producers: [] },
    definitions: {},
    components: { componentForFile: () => ({ errorDomain: "runtime" }),
      forComponent: componentId => ({ componentId, errorDomain: "project", errorOwnerComponentId: componentId }) },
  });
  assert.equal(result.kind, "resolved");
  const region = result.value.get(declaration);
  assert.equal(region !== undefined, true);
  return region;
}

test("JS body regions select identity, retained, uninhabited and package conversions once", () => {
  const nativeErrors = [
    { identity: "js-rejection", errorType: rustJsValueTargetType() },
    { identity: "native", errorType: rustRuntimeErrorTargetType() },
    { identity: "empty", errorType: { kind: "target-named", id: rustInfallibleTargetId } },
  ];
  const region = selectRegion(nativeErrors, true);
  assert.equal(region.jsRejection !== undefined, true);
  assert.equal(region.jsRejection.local.kind, "retained-error");
  const conversions = selectRustJsRejectionRegion(region.localOwner, nativeErrors);
  assert.equal(conversions !== undefined, true, "every original native channel has its exact policy conversion before inhabited-source selection");
  assert.deepEqual(conversions.sources.map(source => [source.identity, source.conversion.kind]), [
    ["js-rejection", "identity"], ["native", "retained-error"], ["empty", "uninhabited"],
  ]);
  assert.deepEqual(region.jsRejection.sources.map(source => [source.identity, source.conversion.kind]), [
    ["js-rejection", "identity"], ["native", "retained-error"],
  ]);
  assert.equal(region.sources.some(source => source.identity === "empty"), false,
    "an uninhabited payload does not create an unused native error variant");
  assert.equal(region.jsRejection.requiredCarriers.length, 2);
  assert.equal(region.jsRejection.requiredCarriers.some(carrier => rustTargetTypeRefEquals(carrier,
    rustRuntimeErrorTargetType())), true);
  assert.equal(Object.isFrozen(region.jsRejection), true);
});

test("native error joins retain an explicit conversion per leaf instead of assuming Into for the join", () => {
  const joined = rustNativeErrorJoinTargetType("/src/external.ts", [
    rustRuntimeErrorTargetType(), rustJsValueTargetType(),
  ]);
  const region = selectRegion([{ identity: "joined", errorType: joined }]);
  assert.equal(region.jsRejection !== undefined, true);
  const conversion = region.jsRejection.sources[0].conversion;
  assert.equal(conversion.kind, "native-join");
  assert.deepEqual(conversion.arms.map(arm => arm.kind), ["retained-error", "identity"]);
  assert.equal(region.jsRejection.requiredCarriers.length, 1);
  assert.equal(rustTargetTypeRefEquals(region.jsRejection.requiredCarriers[0], rustRuntimeErrorTargetType()), true);
});

test("project package errors select their closed-value route, not an invented retained-error trait", () => {
  const errorType = rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "external" });
  const region = selectRegion([{ identity: "package", errorType }]);
  assert.equal(region.jsRejection !== undefined, true);
  assert.equal(region.jsRejection.sources[0].conversion.kind, "program-error");
  assert.equal(region.jsRejection.sources[0].conversion.owner.componentId, "external");
  assert.equal(region.jsRejection.requiredCarriers.length, 0);
});

test("native body regions keep exact sources without a JS conversion projection", () => {
  const errorType = rustRuntimeErrorTargetType();
  const region = selectRegion([{ identity: "native", errorType }], false, false);
  assert.equal(region.kind, "native");
  assert.equal(Object.hasOwn(region, "jsRejection"), false);
  assert.equal(rustTargetTypeRefEquals(region.sources[0].errorType, errorType), true);
});
