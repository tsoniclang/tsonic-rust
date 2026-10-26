import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { rustProgramErrorRuntimeRouteMatches, selectRustProgramErrorConversion } from "../../../../dist/policy/conversions/program-error.js";
import { selectRustProgramErrorRoute } from "../../../../dist/analysis/errors/source-packages.js";
import { planRustProgramErrorConstruction } from "../../../../dist/backend/planner/expressions/program-errors.js";
import { rustJsErrorTargetType, rustNamedTargetType, rustSourceTypeCarrier, rustSourceUnionTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

test("native error union planning preserves nested paths, original payloads and exact package ownership", () => {
  const builtin = rustJsErrorTargetType();
  const native = rustNamedTargetType("native.Failure", "NativeFailure");
  const project = rustSourceTypeCarrier("/src/index.ts", "Failure", "object");
  const inner = rustSourceUnionTargetType("/src/index.ts", "Inner");
  const outer = rustSourceUnionTargetType("/src/index.ts", "Outer");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerProgramErrorOrigin(native, { kind: "provider" }), true);
  assert.equal(registry.registerProgramErrorOrigin(project, { kind: "project", variant: "Failure", sourceError: true }), true);
  assert.equal(registry.registerSourceUnion({ carrier: inner, variants: [
    { name: "Builtin", carrier: builtin }, { name: "Native", carrier: native },
  ] }, true), true);
  assert.equal(registry.registerSourceUnion({ carrier: outer, variants: [
    { name: "Nested", carrier: inner }, { name: "Project", carrier: project },
  ] }, true), true);
  const definitions = registry.seal();
  const conversion = selectRustProgramErrorConversion(outer, undefined, definitions);
  assert.ok(conversion);
  const program = rustProgramWithTypeEmissions([conversion.target, inner, outer], {
    source: "export class Failure extends Error {}\n", typeDefinitions: definitions,
  });
  const definition = program.projectTypes.definitionForCarrier(project);
  assert.equal(definition !== undefined, true, "the error fixture retains its actual checked class definition");
  const policy = {
    definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, project) ? definition : undefined,
    programErrorVariant: current => current === definition ? "Failure" : undefined,
    openCarrier: () => project,
  };
  const boundary = { componentId: "root", errorDomain: "project", errorTypePath: "rt::TsonicError" };
  function context(owner = "root", projectTypes = policy) {
    const sourcePackageErrors = {
      componentIdByDefinition: new Map([[definition, owner]]),
      domainsByComponentId: new Map([["root", { definitions: [definition], externalErrors: [] }]]),
      dependencyErrorsByComponentId: new Map(),
    };
    const records = createRustRecordFixture({
      sourceTypeIdentity: { get: (fileName, typeName) => fileName === "/src/index.ts" &&
        ["Inner", "Outer"].includes(typeName) ? { targetName: typeName, native: false }
        : program.records.sourceTypeIdentity.get(fileName, typeName) },
      projectType: { get: carrier => projectTypes.definitionForCarrier(carrier) },
      projectError: { get: selected => selected === definition ? {
        variant: projectTypes.programErrorVariant(selected), carrier: projectTypes.openCarrier(selected),
        sourceError: true, superTrait: false, inherited: false, fields: [],
      } : undefined },
      programErrorRoute: { get: (consumer, selected, variant) =>
        selectRustProgramErrorRoute(sourcePackageErrors, consumer, selected, variant) },
    }, program.records);
    return { diagnostics: [], usedAliases: new Set(), moduleName: "index",
      sourceFile: program.sourceFiles[0], nativeHeaderPlacement: program.sourceFiles[0], nativeHeaderParent: undefined,
      sourcePackageComponentId: "root",
      moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
      externalCrateNameByFileName: new Map(),
      syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() },
      input: { program: { typeDefinitions: definitions, records,
        names: { nameForSourceType: (_file, name) => name }, source: { ast: {
          getFileName: () => "/src/index.ts", getSourceText: () => "", pos: () => 0, end: () => 0,
          kindName: () => "KindIdentifier",
        } } } },
      sourcePackageErrors,
    };
  }
  const input = context();
  const value = { kind: "path", path: "original" };
  const planned = planRustProgramErrorConstruction(conversion, value, undefined, input, boundary);
  assertNoTargetDiagnostics(input.diagnostics);
  assert.equal(planned.kind, "match");
  assert.equal(planned.expression, value);
  assert.deepEqual(planned.arms.map(arm => arm.expression.path), ["rt::TsonicError::from", "rt::TsonicError::from", "rt::TsonicError::Failure"]);
  assert.deepEqual(planned.arms.map(arm => [arm.pattern.path, arm.pattern.elements[0].path]), [
    ["Outer::Nested", "Inner::Builtin"], ["Outer::Nested", "Inner::Native"], ["Outer::Project", undefined],
  ]);
  for (const arm of planned.arms) {
    const binding = arm.pattern.path === "Outer::Project" ? arm.pattern.elements[0] : arm.pattern.elements[0].elements[0];
    assert.deepEqual(arm.expression.args, [{ kind: "path", path: binding.name }]);
  }
  const nativeRoute = conversion.route.arms.find(arm => rustTargetTypeRefEquals(arm.carrier, native)).route;
  for (const registered of [[], [builtin]]) {
    assert.equal(rustProgramErrorRuntimeRouteMatches(nativeRoute, native, registered), false,
      "Runtime error construction has no exact registered native error carrier.");
  }
  for (const [changed, message] of [
    [context("unrelated"), "An admitted project error requires its exact native package transport route."],
    [context("root", { ...policy, programErrorVariant: () => "Changed" }), "An admitted project error requires its exact source-package variant identity."],
    [context("root", { ...policy, openCarrier: () => builtin }), "An admitted project error requires its exact source-package variant identity."],
  ]) {
    assert.throws(() => planRustProgramErrorConstruction(conversion, value, undefined, changed, boundary),
      error => error.message === message, message);
    assertNoTargetDiagnostics(changed.diagnostics);
  }
});
