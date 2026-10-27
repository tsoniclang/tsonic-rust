import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";

function selectedTypedLocationPlan(program, node) {
  const handler = program.records.nativeHandler.get(node);
  return handler?.kind === "typed-location" ? handler.selection.plan : undefined;
}
import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { acmeFilesPackage, analyzeRust } from "../../../helpers/rust-session.mjs";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { rustCapturedBindingStorage } from "../../../../dist/analysis/callables/storage/capture-storage.js";
import { rustRetainedCallSubstitutions } from "../../../../dist/analysis/callables/ownership/retained-call-lifetimes.js";
import { rustArgumentPassingMode } from "../../../../dist/policy/ownership/argument-passing.js";
import { rustLifetimeKey } from "../../../../dist/target-model/lifetimes/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../../dist/target-model/types/carriers/optional.js";

function nodesOf(source, files) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  files.forEach(visit);
  return nodes;
}

function assertReader(records, family) {
  assert.equal(Object.isFrozen(records[family]), true, family);
  assert.equal(records[family].set === undefined, true, family);
  assert.equal(records[family].get({}) === undefined, true, family);
  assert.equal(records[family].get(undefined) === undefined, true, family);
}

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`ordinary nested arguments publish exact checked call inputs in ${surface}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      function identity(value: int32): int32 { return value; }
      export function run(value: int32): int32 { return identity(identity(value)); }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const calls = nodes.filter(node => source.ast.is.IsCallExpression(node));
    assert.equal(calls.length, 2);
    const arguments_ = calls.map(node => source.ast.arguments(node)[0]);
    for (const call of calls) assert.equal(requiredRecords.some(row => row.family === "retainedCallLifetimes" && row.subject === call), false);
    assert.equal(nodes.filter(node => program.records.argumentPassing.get(node) !== undefined).length, 2);
    for (const argument of arguments_) {
      assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
      const fact = program.records.argumentPassing.get(argument);
      assert.equal(fact?.mode, "by-value");
      assert.equal(Object.hasOwn(fact, "storageExpression"), false);
      assert.equal(Object.isFrozen(fact), true);
      assert.equal(program.records.runtimeCarrier.get(argument)?.carrier.name, "int32");
    }
    assertReader(program.records, "argumentPassing");
  });

  test(`provider arguments publish the actual selected native ABI passing mode in ${surface}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, packages: [acmeFilesPackage()], files: { "index.ts": `
      import { readText } from "@acme/files";
      export function run(path: string): string { return readText(path); }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const calls = nodes.filter(node => source.ast.is.IsCallExpression(node));
    assert.equal(calls.length, 1);
    const call = calls[0];
    const operation = program.records.targetOperation.get(call);
    assert.equal(operation?.kind, "provider-operation");
    const runtimeArguments = operation.abi.sourceArguments.filter(argument => argument.disposition === "runtime");
    assert.equal(runtimeArguments.length, 1);
    assert.equal(runtimeArguments[0].sourceIndex, 0);
    const argument = source.ast.arguments(call)[0];
    assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
    const passing = program.records.argumentPassing.get(argument);
    assert.equal(passing?.mode, rustArgumentPassingMode(runtimeArguments[0].mode));
    assert.equal(passing.storageExpression === argument, passing.mode === "borrow-shared" || passing.mode === "borrow-mut");
    assert.equal(Object.isFrozen(passing), true);
    assertReader(program.records, "argumentPassing");
  });

  for (const [reference, mutable] of [["Ref", false], ["Mut", true]]) {
    test(`native ${reference} inputs retain selected reference carriers without a second passing wrapper in ${surface}`, () => {
      const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
        import type { int32 } from "@tsonic/core/types.js";
        import type { Life, ${reference} } from "@tsonic/rust/types.js";
        function identity<Region extends Life>(value: ${reference}<int32, Region>): ${reference}<int32, Region> { return value; }
        export function run(value: ${reference}<int32>): ${reference}<int32> { return identity(value); }
      ` } });
      const nodes = nodesOf(source, program.sourceFiles);
      const calls = nodes.filter(node => source.ast.is.IsCallExpression(node));
      assert.equal(calls.length, 1);
      const call = calls[0];
      const argument = source.ast.arguments(call)[0];
      assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
      assertRustRecordRequirement(requiredRecords, "callScopedLifetimeReconciliation", argument);
      const passing = program.records.argumentPassing.get(argument);
      assert.equal(passing?.mode, "by-value", "the native reference is already the selected argument value");
      assert.equal(Object.hasOwn(passing, "storageExpression"), false);
      const operation = program.records.targetOperation.get(call);
      assert.equal(operation?.kind, "source-call");
      assert.equal(operation.parameters.length, 1);
      const parameter = operation.parameters[0];
      assert.equal(parameter.mode, "value");
      assert.equal(parameter.parameterCarrier.kind, "reference");
      assert.equal(parameter.parameterCarrier.mutable, mutable);
      assert.equal(parameter.parameterCarrier.referent.name, "int32");
      assert.equal(parameter.parameterCarrier.lifetime.kind, "call-scoped-elision");
      const reconciliation = program.records.callScopedLifetimeReconciliation.get(argument);
      assert.equal(reconciliation !== undefined, true);
      assert.equal(rustTargetTypeRefEquals(reconciliation.selectedCarrier, parameter.parameterCarrier), true);
      assert.equal(program.records.bindingStorage.get(argument) === undefined, true);
      assertReader(program.records, "argumentPassing");
    });
  }

  test(`typed-location calls construct canonical pointer and local-storage records in ${surface}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      import { addressof, allocateptr, loadptr, storeptr, equalptr, hashptr } from "@tsonic/core/lang.js";
      export function run(value: int32): int32 {
        let local = value;
        const pointer = addressof(local);
        const allocated = allocateptr<int32>(2);
        storeptr(pointer, loadptr(allocated));
        return equalptr(pointer, allocated) ? loadptr(pointer) : hashptr(pointer) as int32;
      }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const identities = new Set(nodes);
    const expectedCalls = nodes.filter(node => source.ast.is.IsCallExpression(node));
    assert.equal(expectedCalls.length, 7);
    for (const call of expectedCalls) {
      assertRustRecordRequirement(requiredRecords, "typedLocationPlan", call);
      for (const argument of source.ast.arguments(call)) assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
    }
    const local = nodes.find(node => source.ast.is.IsVariableDeclaration(node) && source.ast.text(source.ast.name(node)) === "local");
    assertRustRecordRequirement(requiredRecords, "bindingStorage", local);
    const selected = nodes.filter(node => selectedTypedLocationPlan(program, node) !== undefined);
    assert.equal(selected.length, 7);
    assert.deepEqual([...new Set(selected.map(node => selectedTypedLocationPlan(program, node).operation))].sort(),
      ["address-of", "allocate", "equal-pointer", "hash-pointer", "load", "store"]);
    for (const call of selected) {
      const plan = selectedTypedLocationPlan(program, call);
      assert.equal(source.ast.is.IsCallExpression(call), true);
      assert.equal(plan.call === call, true);
      assert.equal(plan.pointeeCarrier.name, "int32");
      assert.equal(Object.isFrozen(plan), true);
      const operation = program.records.targetOperation.get(call);
      assert.equal(operation?.kind, "typed-location");
      assert.equal(rustTargetTypeRefEquals(operation.pointeeCarrier, plan.pointeeCarrier), true);
      assert.equal(rustTargetTypeRefEquals(operation.locationCarrier, plan.locationCarrier), true);
      for (const argument of source.ast.arguments(call)) {
        assert.equal(program.records.argumentPassing.get(argument)?.mode, "by-value");
      }
      if (plan.operation === "address-of") {
        for (const node of [plan.storageExpression, plan.storageDeclaration, plan.rootExpression, plan.rootDeclaration, plan.locationIdentity]) {
          assert.equal(identities.has(node), true, "exact checked storage provenance");
        }
        const backing = program.records.bindingStorage.get(plan.rootDeclaration);
        assert.equal(backing?.storage, "location");
        assert.equal(backing.valueCarrier === plan.pointeeCarrier, true);
        assert.equal(Object.isFrozen(backing), true);
      }
    }
    assert.equal(nodes.filter(node => program.records.bindingStorage.get(node) !== undefined).length, 1);
    assertReader(program.records, "nativeHandler");
    assert.equal(Object.hasOwn(program.records, "typedLocationPlan"), false);
    assertReader(program.records, "bindingStorage");
  });

  test(`required and optional projected pointers retain their exact source operands in ${surface}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      import type { int32, Pointer } from "@tsonic/core/types.js";
      import { projectptr } from "@tsonic/core/lang.js";
      export function required(pointer: Pointer<int32>): Pointer<int32> {
        return projectptr<int32, int32>(pointer, value => value + 1, value => value - 1);
      }
      export function optional(pointer: Pointer<int32> | undefined): Pointer<int32> | undefined {
        return projectptr<int32, int32>(pointer, value => value + 1, value => value - 1);
      }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const selected = nodes.filter(node => selectedTypedLocationPlan(program, node)?.operation === "project-pointer");
    const expectedCalls = nodes.filter(node => source.ast.is.IsCallExpression(node));
    assert.equal(expectedCalls.length, 2);
    for (const call of expectedCalls) {
      assertRustRecordRequirement(requiredRecords, "typedLocationPlan", call);
      for (const argument of source.ast.arguments(call)) assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
    }
    assert.equal(selected.length, 2);
    assert.deepEqual(selected.map(node => selectedTypedLocationPlan(program, node).optional), [false, true]);
    for (const call of selected) {
      const fact = selectedTypedLocationPlan(program, call);
      const arguments_ = source.ast.arguments(call);
      assert.equal(fact.call === call && fact.pointerExpression === arguments_[0], true);
      assert.equal(fact.fromSourceExpression === arguments_[1] && fact.toSourceExpression === arguments_[2], true);
      assert.equal(fact.sourcePointeeCarrier.name, "int32");
      assert.equal(fact.pointeeCarrier.name, "int32");
      assert.equal(Object.isFrozen(fact), true);
      for (const argument of arguments_) assert.equal(program.records.argumentPassing.get(argument)?.mode, "by-value");
    }
    assertReader(program.records, "nativeHandler");
    assert.equal(Object.hasOwn(program.records, "typedLocationPlan"), false);
  });

  test(`pointer views and bound callbacks use the same canonical location constructor in ${surface}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      import type { int32, Pointer } from "@tsonic/core/types.js";
      import { bindptr, viewptr } from "@tsonic/core/lang.js";
      class Identity { value: int32 = 0; }
      export function bind(identity: Identity): Pointer<int32> { return bindptr<int32>(identity, () => 1, _next => {}); }
      export function view(pointer: Pointer<int32>): Pointer<int32> { return viewptr<int32, int32>(pointer, () => 2, _next => {}); }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const selected = nodes.filter(node => selectedTypedLocationPlan(program, node) !== undefined);
    assert.equal(selected.length, 2);
    const expectedCalls = nodes.filter(node => source.ast.is.IsCallExpression(node));
    assert.equal(expectedCalls.length, 2);
    for (const call of expectedCalls) {
      assertRustRecordRequirement(requiredRecords, "typedLocationPlan", call);
      for (const argument of source.ast.arguments(call)) assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
    }
    assert.deepEqual(selected.map(node => selectedTypedLocationPlan(program, node).operation).sort(), ["bind-pointer", "view-pointer"]);
    for (const call of selected) {
      const fact = selectedTypedLocationPlan(program, call);
      const arguments_ = source.ast.arguments(call);
      assert.equal(fact.call === call, true);
      assert.equal(fact.readExpression === arguments_[1] && fact.writeExpression === arguments_[2], true);
      assert.equal(fact.pointeeCarrier.name, "int32");
      assert.equal(Object.isFrozen(fact), true);
      if (fact.operation === "view-pointer") {
        assert.equal(fact.pointerExpression === arguments_[0], true);
        assert.equal(fact.sourcePointeeCarrier.name, "int32");
        assert.equal(fact.optional, false);
      } else assert.equal(fact.identityExpression === arguments_[0], true);
      for (const argument of arguments_) assert.equal(program.records.argumentPassing.get(argument)?.mode, "by-value");
    }
    assertReader(program.records, "nativeHandler");
    assert.equal(Object.hasOwn(program.records, "typedLocationPlan"), false);
  });

  test(`retained source calls preserve the actual callee/caller lifetime substitution in ${surface}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      function retain(callback: () => int32): () => int32 { return callback; }
      export function run(callback: () => int32): () => int32 { return retain(callback); }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const declarations = nodes.filter(node => source.ast.is.IsFunctionDeclaration(node));
    const callee = declarations.find(node => source.ast.text(source.ast.name(node)) === "retain");
    const caller = declarations.find(node => source.ast.text(source.ast.name(node)) === "run");
    assert.equal(callee !== undefined && caller !== undefined, true);
    assertRustRecordRequirement(requiredRecords, "retainedEnvironment", callee);
    assertRustRecordRequirement(requiredRecords, "retainedEnvironment", caller);
    const expectedCalls = nodes.filter(node => source.ast.is.IsCallExpression(node));
    assert.equal(expectedCalls.length, 1);
    assertRustRecordRequirement(requiredRecords, "retainedCallLifetimes", expectedCalls[0]);
    assertRustRecordRequirement(requiredRecords, "argumentPassing", source.ast.arguments(expectedCalls[0])[0]);
    const selected = nodes.filter(node => program.records.retainedCallLifetimes.get(node) !== undefined);
    assert.equal(selected.length, 1);
    const call = selected[0];
    assert.equal(source.ast.is.IsCallExpression(call), true);
    const entries = program.records.retainedCallLifetimes.get(call);
    assert.equal(entries.length, 1);
    assert.equal(Object.isFrozen(entries) && Object.isFrozen(entries[0]), true);
    const calleeEnvironment = program.records.retainedEnvironment.get(callee);
    const callerEnvironment = program.records.retainedEnvironment.get(caller);
    assert.equal(calleeEnvironment !== undefined && callerEnvironment !== undefined, true);
    assert.equal(entries[0].identity, rustLifetimeKey(calleeEnvironment.lifetime));
    assert.equal(rustLifetimeKey(entries[0].lifetime), rustLifetimeKey(callerEnvironment.lifetime));
    assert.equal(calleeEnvironment.parameters[0] === source.ast.parameters(callee)[0], true);
    assert.equal(callerEnvironment.parameters[0] === source.ast.parameters(caller)[0], true);
    const substitutions = rustRetainedCallSubstitutions(program.records, call);
    assert.equal(substitutions.get(entries[0].identity) === entries[0].lifetime, true);
    assert.equal(program.records.argumentPassing.get(source.ast.arguments(call)[0])?.mode, "by-value");
    assertReader(program.records, "retainedCallLifetimes");
  });

  test(`binding projection construction keeps checked leaf carriers, defaults and rest in ${surface}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      interface Pair { left: int32; right: int32; }
      export function run(pair: Pair, values: int32[]): int32 {
        const { left: value, ...other } = pair;
        const [first = 4, ...tail] = values;
        return value + other.right + first + tail[0];
      }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const bindings = nodes.filter(node => program.records.bindingProjection.get(node) !== undefined);
    const expectedBindings = nodes.filter(node => source.ast.kindName(node) === "KindBindingElement");
    assert.equal(expectedBindings.length, 4);
    for (const binding of expectedBindings) {
      assertRustRecordRequirement(requiredRecords, "bindingProjection", binding);
      assert.equal(requiredRecords.some(row => row.family === "bindingProjection" && row.subject === source.ast.name(binding)), false);
    }
    assert.equal(bindings.length, 4);
    const forms = [];
    for (const binding of bindings) {
      const fact = program.records.bindingProjection.get(binding);
      assert.equal(source.ast.kindName(binding), "KindBindingElement");
      assert.equal(Object.isFrozen(fact), true);
      assert.equal(rustTargetTypeRefEquals(fact.bindingCarrier, program.records.runtimeCarrier.get(binding)?.carrier), true);
      const name = source.ast.name(binding);
      assert.equal(rustTargetTypeRefEquals(fact.bindingCarrier, program.records.runtimeCarrier.get(name)?.carrier), true);
      forms.push(fact.projection.kind);
      if (fact.projection.kind === "js-array-element" || fact.projection.kind === "vec-element") {
        assert.equal(fact.normalization, surface === "js" ? "checked-array-default" : "default-on-none");
        assert.equal(fact.bindingCarrier.name, "int32");
        assert.equal(rustOptionElementCarrier(fact.projectedCarrier)?.name, "int32");
      }
      if (fact.projection.kind === "object-rest") {
        assert.equal(fact.projection.fields.length, 1);
        assert.equal(fact.projection.fields[0].carrier.name, "int32");
      }
    }
    assert.deepEqual(forms.sort(), ["object-field", "object-rest", `${surface === "js" ? "js-array" : "vec"}-element`,
      `${surface === "js" ? "js-array" : "vec"}-rest`].sort());
    assertReader(program.records, "bindingProjection");
  });
}

test("closed JS object projections preserve the selected object-literal borrow", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": `
    export function inspect(): string[] { const pair = { left: 1, right: 2 }; return Object.keys(pair); }
  ` } });
  const nodes = nodesOf(source, program.sourceFiles);
  const calls = nodes.filter(node => source.ast.is.IsCallExpression(node));
  assert.equal(calls.length, 1);
  const argument = source.ast.arguments(calls[0])[0];
  assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
  const passing = program.records.argumentPassing.get(argument);
  assert.equal(passing?.mode, "borrow-shared");
  assert.equal(passing.storageExpression === argument, true);
  assert.equal(program.records.targetOperation.get(calls[0])?.kind, "object-shape-projection");
  assert.equal(Object.isFrozen(passing), true);
  assertReader(program.records, "argumentPassing");
});

test("closed JS array predicates borrow the actual checked value without a conversion or invented storage", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": `
    export function inspect(value: unknown): boolean { return Array.isArray(value); }
  ` } });
  const nodes = nodesOf(source, program.sourceFiles);
  const calls = nodes.filter(node => source.ast.is.IsCallExpression(node));
  assert.equal(calls.length, 1);
  const argument = source.ast.arguments(calls[0])[0];
  const passing = program.records.argumentPassing.get(argument);
  assert.equal(passing?.mode, "borrow-shared");
  assert.equal(passing.storageExpression === argument, true);
  assert.equal(Object.isFrozen(passing), true);
  assertRustRecordRequirement(requiredRecords, "argumentPassing", argument);
  assert.equal(requiredRecords.some(row => row.family === "bindingStorage" && row.subject === argument), false);
  assert.equal(program.records.targetOperation.get(calls[0])?.kind, "closed-type-test");
  assert.equal(program.records.conversion.get(argument) === undefined, true);
  assert.equal(program.records.bindingStorage.get(argument) === undefined, true);
  assertReader(program.records, "argumentPassing");
});

for (const [type, carrier, expression, expected] of [
  ["number", { kind: "source-primitive", name: "float64" }, "seed += 1;", "cell"],
  ["string", { kind: "target-named", id: "rust.std.String" }, 'seed = seed + "!";', "borrow-cell"],
]) {
  for (const singleOwner of [false, true]) {
    test(`lower-owner checked ${type} capture publishes ${singleOwner ? expected : "location"} without claiming full-pipeline admission`, () => {
      const checked = createCompilerSessionFromFiles({ currentDirectory: "/project", files: { "/project/index.ts": `
        export function outer(seed: ${type}) {
          const callback = () => { ${expression} return seed; };
          return callback;
        }
      ` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
      assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 1024));
      const source = createTargetSourceProgram(checked);
      const file = checked.getSourceFile("/project/index.ts");
      assert.equal(file !== undefined, true);
      const nodes = nodesOf(source, [file]);
      const declaration = nodes.find(node => source.ast.is.IsParameterDeclaration(node) && source.ast.text(source.ast.name(node)) === "seed");
      const callback = nodes.find(node => source.ast.is.IsVariableDeclaration(node) && source.ast.text(source.ast.name(node)) === "callback");
      const owner = callback === undefined ? undefined : source.ast.as.AsVariableDeclaration(callback)?.Initializer;
      assert.equal(declaration !== undefined && owner !== undefined, true);
      const reference = source.navigation.declarationUseSummary(declaration).uses.find(use => use.kind !== "type-only")?.reference;
      assert.equal(reference !== undefined, true);
      const records = createRustProgramRecordBuilder();
      const walk = { context: { ast: source.ast, source, records, requiredRecords: [] }, capturedBindingStorage: new Map(),
        promotedStorageDeclarations: new Set() };
      const selected = rustCapturedBindingStorage(walk, declaration, reference, owner, carrier, singleOwner);
      assertRustRecordRequirement(walk.context.requiredRecords, "bindingStorage", declaration);
      assert.equal(selected?.storage, singleOwner ? expected : "location");
      const fact = records.seal(walk.context.requiredRecords).bindingStorage.get(declaration);
      assert.equal(fact?.storage, selected.storage);
      assert.equal(fact.valueCarrier === carrier, true);
      assert.equal(Object.isFrozen(fact), true);
      assert.equal(records.bindingStorage.get(reference) === undefined, true, "storage belongs to the checked binding, not a read");
      assertReader(records, "bindingStorage");
    });
  }
}
