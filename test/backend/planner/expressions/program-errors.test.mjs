import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { selectRustProgramErrorConversion } from "../../../../dist/target-model/conversions/program-error.js";
import { planRustProgramErrorConstruction } from "../../../../dist/backend/planner/expressions/program-errors.js";
import { rustJsErrorTargetType, rustSourceTypeCarrier, rustSourceUnionTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

test("native error union planning preserves nested paths, original payloads and exact package ownership", () => {
  const builtin = rustJsErrorTargetType();
  const native = { kind: "target-named", id: "native.Failure" };
  const project = rustSourceTypeCarrier("/src/failure.ts", "Failure", "object");
  const definition = {};
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
  const policy = {
    definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, project) ? definition : undefined,
    programErrorVariant: current => current === definition ? "Failure" : undefined,
    openCarrier: () => project,
  };
  const conversion = selectRustProgramErrorConversion(outer, undefined, definitions);
  assert.ok(conversion);
  const boundary = { componentId: "root", errorDomain: "project", errorTypePath: "rt::TsonicError" };
  function context(registered = [native], owner = "root", projectTypes = policy) {
    return { diagnostics: [], usedAliases: new Set(), moduleName: "index",
      moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
      externalCrateNameByFileName: new Map(),
      syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() },
      input: { program: { typeDefinitions: definitions, projectTypes, providerErrorCarriers: registered,
        names: { nameForSourceType: (_file, name) => name }, source: { ast: {
          getFileName: () => "/src/index.ts", getSourceText: () => "", pos: () => 0, end: () => 0,
          kindName: () => "KindIdentifier",
        } } } },
      sourcePackageErrors: {
        componentIdByDefinition: new Map([[definition, owner]]),
        domainsByComponentId: new Map([["root", { definitions: [definition], externalErrors: [] }]]),
        dependencyErrorsByComponentId: new Map(),
      },
    };
  }
  const input = context();
  const value = { kind: "path", path: "original" };
  const planned = planRustProgramErrorConstruction(conversion, value, undefined, input, boundary);
  assert.deepEqual(input.diagnostics, []);
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
  for (const [changed, message] of [
    [context([]), "Runtime error construction has no exact registered native error carrier."],
    [context([builtin]), "Runtime error construction has no exact registered native error carrier."],
    [context([native], "unrelated"), "Project error construction has no exact route through the selected source-package error domain."],
    [context([native], "root", { ...policy, programErrorVariant: () => "Changed" }), "Project error construction has no exact route through the selected source-package error domain."],
    [context([native], "root", { ...policy, openCarrier: () => builtin }), "Project error construction has no exact route through the selected source-package error domain."],
  ]) {
    assert.equal(planRustProgramErrorConstruction(conversion, value, undefined, changed, boundary), undefined);
    assert.equal(changed.diagnostics.length, 1);
    assert.equal(changed.diagnostics[0].message, `${message} Node kind: KindIdentifier.`);
  }
});
