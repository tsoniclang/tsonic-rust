import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRustSourcePackageComponents } from "../../../dist/analysis/source-modules/component-semantics.js";
import { normalizeRustErrorType, selectRustPhysicalProgramErrorOwner } from "../../../dist/analysis/errors/error-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustJsValueTargetType, rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustNamedTargetType, rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinTargetType, rustNativeErrorJoinReference } from "../../../dist/target-model/types/native-error-joins.js";
import { selectRustErrorRegion } from "../../../dist/analysis/errors/regions.js";
import { nativeCallbackParametersSource } from "../../../../tsonic/test/fixtures/native-callback-parameters.mjs";
import { rustRuntimeCallableTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustNativeCallableErrorType } from "../../../dist/policy/types/callables/native-protocols.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { Node_Expression } from "@tsonic/target-api/source";
import { createRustSourceErrorEffectSelection } from "../../../dist/analysis/errors/source-error-effects.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustCallablePhysicalCarrier, rustUninhabitedError } from "../../../dist/policy/conversions/callable-physical.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { nativeClosureProducerFailurePackage } from "../../helpers/native-closure-producers.mjs";


function fixture(text = `
    class Failure extends Error {}
    export async function pureLeft(): Promise<string> { return "left"; }
    export async function pureRight(): Promise<string> { return "right"; }
    export async function failLeft(): Promise<string> { throw new Failure("left"); }
    export async function failRight(): Promise<string> { throw new Failure("right"); }
    export function forwarded(): Promise<string> { return failLeft(); }
  `, options = {}) {
  const context = analyzeRustErrorEffects(text, options);
  const classified = analyzeRustSourcePackageComponents(context, "lib", subject => context.records.errorEffects.get(subject));
  assert.equal(classified.kind, "resolved");
  const producers = context.callableValues.nativeProducers;
  const producer = name => producers.producers.find(candidate => {
    const selected = context.ast.name(candidate.declaration);
    return selected !== undefined && context.ast.text(selected) === name;
  });
  const input = { ast: context.ast, records: context.records, definitions: context.typeDefinitions,
    producers, components: classified.plan };
  const error = name => producers.errorFor(producer(name).declaration, name === "forwarded" ? 0 : "body");
  return { context, input, producer, error, native: context.callableValues.native };
}

for (const surfaces of [[], ["js"]]) {
  test(`implicit disposal preserves closed native channels without inventing invocation bindings (${surfaces[0] ?? "native"})`, () => {
    const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure");
    const context = analyzeRustErrorEffects(`
      import { fail } from "test:producer";
      class Resource {
        [Symbol.dispose](): void { fail(); }
        get value(): number { return fail(); }
      }
      function ordinary(): number { return fail(); }
      function invoke(callback: () => number): number { return callback(); }
      export function run(): void {
        using resource = new Resource();
        ordinary();
        resource.value;
        invoke(() => fail());
      }
    `, { surfaces, packages: [nativeClosureProducerFailurePackage(failure)] });
    const { ast, records } = context;
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    context.sourceFiles.forEach(visit);
    const disposer = nodes.find(node => {
      if (!ast.is.IsMethodDeclaration(node)) return false;
      const name = ast.name(node);
      const expression = name === undefined || !ast.is.IsComputedPropertyName(name)
        ? undefined : ast.as.AsComputedPropertyName(name)?.Expression;
      if (expression === undefined || !ast.is.IsPropertyAccessExpression(expression)) return false;
      const owner = Node_Expression(ast, expression);
      const member = ast.name(expression);
      return owner !== undefined && ast.is.IsIdentifier(owner) && ast.text(owner) === "Symbol" &&
        member !== undefined && ast.is.IsIdentifier(member) && ast.text(member) === "dispose";
    });
    const resource = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.variableDeclarationKind(node) === "using");
    const ordinary = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "ordinary");
    const getter = nodes.find(node => ast.is.IsGetAccessorDeclaration(node));
    const ordinaryCall = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(Node_Expression(ast, node)) === "ordinary");
    const accessor = nodes.find(node => ast.is.IsPropertyAccessExpression(node) && ast.text(ast.name(node)) === "value");
    assert.equal([disposer, resource, ordinary, getter, ordinaryCall, accessor].every(node => node !== undefined), true,
      "actual checked cleanup, ordinary call and accessor subjects exist");
    const effects = records.errorEffects.get(disposer);
    assert.equal(effects?.localErrors, false, "the disposer does not rebrand the native failure as a local throw");
    assert.equal(effects?.nativeErrors.length, 1, "the disposer retains its one original native channel");
    const original = effects.nativeErrors[0];
    assert.equal(rustTargetTypeRefEquals(original.errorType, failure), true, "the original native carrier is retained");
    for (const [label, subject, declaration] of [["cleanup", resource, disposer],
      ["ordinary", ordinaryCall, ordinary], ["accessor", accessor, getter]]) {
      const edges = records.sourceErrorEffects.get(subject)?.edges.filter(edge => edge.declaration === declaration) ?? [];
      assert.equal(edges.length, 1, label + ": the exact source executes through one selected error edge");
      assert.equal(edges[0].effects.localErrors, false, label + ": no local error branding is invented");
      assert.equal(edges[0].nativeErrors.length, 1, label + ": the original native channel is not erased or duplicated");
      assert.equal(edges[0].nativeErrors[0].source.identity, original.identity, label + ": original source identity");
      assert.equal(edges[0].nativeErrors[0].target.identity, original.identity, label + ": unchanged native destination identity");
      assert.equal(rustTargetTypeRefEquals(edges[0].nativeErrors[0].target.errorType, failure), true,
        label + ": no boxed or substituted native carrier");
    }
    const invoke = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "invoke");
    const invocation = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(Node_Expression(ast, node)) === "invoke");
    assert.equal(invoke !== undefined && invocation !== undefined, true, "the genuine callback input has its real invocation");
    const dependent = records.errorEffects.get(invoke);
    assert.equal(dependent?.nativeErrors.length, 1, "the actual input retains its associated invocation error");
    const selection = createRustSourceErrorEffectSelection({ context });
    assert.equal(selection.register(dependent.nativeErrors), true, "the original input-dependent channel is registered");
    const carriers = selection.bindingCarriersFor(dependent.nativeErrors);
    const references = rustTargetGenericReferences({ kind: "tuple", elements: carriers });
    assert.equal(references.typeIdentities.length > 0, true, "the input error genuinely requires native substitutions");
    assert.equal(selection.bindingsFor(invocation, invoke, carriers) !== undefined, true,
      "the ordinary checked invocation still binds its actual callback input");
    assert.equal(selection.bindingsFor(resource, invoke, carriers) === undefined, true,
      "an implicit lifecycle subject cannot manufacture the needed callback invocation activation");
    const deferred = { ...dependent.nativeErrors[0], identity: "implicit-disposal-deferred-input" };
    assert.equal(selection.pending(deferred, () => dependent.nativeErrors[0], "completed"), true,
      "completion retains authority over a temporarily hidden native-input channel");
    const deferredCarriers = selection.bindingCarriersFor([deferred]);
    assert.equal(deferredCarriers.length, 0, "no initially visible carrier is not proof of a closed completed error");
    const pending = selection.bindingsFor(resource, invoke, deferredCarriers);
    assert.equal(pending !== undefined, true, "empty initial evidence can reach its original completion owner");
    assert.equal(pending.complete(dependent.nativeErrors[0].errorType, context.callableValues.nativeStorage) === undefined, true,
      "completion still refuses missing real activation when the native-input dependency becomes visible");
  });

  test(`implicit cleanup retains the existing local-throw channel (${surfaces[0] ?? "native"})`, () => {
    const context = analyzeRustErrorEffects(`
      class Resource { [Symbol.dispose](): void { throw new Error("cleanup"); } }
      export function run(): void { using resource = new Resource(); }
    `, { surfaces });
    const { ast, records } = context;
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    context.sourceFiles.forEach(visit);
    const resource = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.variableDeclarationKind(node) === "using");
    assert.equal(resource !== undefined, true, "the original resource declaration exists");
    const edges = records.sourceErrorEffects.get(resource)?.edges ?? [];
    assert.equal(edges.length, 1, "local-throw cleanup keeps its single execution edge");
    assert.equal(edges[0].effects.localErrors, true, "local throw remains in the original local error domain");
    assert.equal(edges[0].effects.nativeErrors.length, 0, "no native channel is invented for a local throw");
    assert.equal(edges[0].nativeErrors.length, 0, "no substitution is fabricated for the local error");
  });
}

test("concrete native Callable invocation errors normalize their bound producer without inventing generic purity", () => {
  const current = fixture(`
    export function invoke(callback: () => string): string { return callback(); }
    export function pure(): string { return "pure"; }
    export function failed(): string { throw new Error("failure"); }
  `);
  const declaration = current.producer("invoke").declaration;
  const inputs = current.native.inputsFor(declaration);
  assert.equal(inputs.length, 1, "the checked declaration has its one actual native input");
  const input = inputs[0];
  assert.equal(input.protocol.method.binder.parameters.length, 0, "the selected invocation has no hidden lifetime arguments");
  assert.equal(input.protocol.signature.typeParameters.length, 0, "the selected invocation has no hidden type arguments");
  const pure = current.input.producers.errorFor(current.producer("pure").declaration, "invoke");
  const failed = current.input.producers.errorFor(current.producer("failed").declaration, "invoke");
  for (const [name, error, expected] of [
    ["pure nested producer", pure, { kind: "target-named", id: "rust.core.Infallible" }],
    ["failed nested producer", failed, normalizeRustErrorType(failed, current.input)],
    ["JS rejection", rustJsValueTargetType(), rustJsValueTargetType()],
  ]) {
    const completion = rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: rustStringTargetType() }, { kind: "type", type: error },
    ]);
    const implementation = rustRuntimeCallableTargetType(rustStaticLifetime, [], completion);
    const associated = rustNativeCallableErrorType(input, implementation, "invocation", []);
    assert.equal(associated !== undefined, true, name + ": the actual native bridge admits the invocation projection");
    assert.equal(expected !== undefined, true, name + ": the original producer owns its exact error");
    const normalized = normalizeRustErrorType(associated, current.input);
    assert.equal(rustTargetTypeRefEquals(normalized, expected), true, name + ": normalization retains the exact bound error");
    assert.equal(Object.isFrozen(normalized), true, name + ": normalized evidence is immutable");
    for (const other of [{ ...associated, name: "AwaitError0" }, { ...associated, trait: { ...associated.trait, id: "foreign:Callable" } }]) {
      assert.equal(normalizeRustErrorType(other, current.input)?.kind, "associated-type",
        name + ": unrelated associated channels are not projected as invocation errors");
    }
  }
  const unbound = rustNativeCallableErrorType(input, input.implementation, "invocation", []);
  assert.equal(unbound !== undefined, true, "the original generic input owns its independent invocation channel");
  assert.equal(rustTargetTypeRefEquals(normalizeRustErrorType(unbound, current.input), unbound), true,
    "a native implementation binder is never guessed to be infallible");
});

test("callable adapter emission uses the canonical exact physical error for every destination", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function pure(value: number): (ignored: number) => number {
      const original = (): number => value;
      return original;
    }
    export function failed(value: number): (ignored: number) => number {
      const original = (): number => { if (value < 0) throw new Error("failure"); return value; };
      return original;
    }
  ` } });
  const input = { ast: program.source.ast, records: program.records, definitions: program.typeDefinitions,
    producers: program.callableValues.nativeProducers, components: program.sourcePackageComponents };
  let selectedCount = 0;
  let pureCount = 0;
  let failedCount = 0;
  const visit = node => {
    const conversion = program.records.contextualValueConversion.get(node)?.conversion;
    if (conversion?.kind === "callable-adapter") {
      const selected = program.records.callableContract.get(node, conversion);
      assert.equal(selected !== undefined, true, "the adapter has one pre-seal physical conversion");
      const error = normalizeRustErrorType(selected.source.signature.error, input, node);
      assert.equal(error !== undefined, true, "the actual source error has exact native evidence");
      assert.equal(rustTargetTypeRefEquals(selected.source.signature.error, error), true,
        "emission retains the canonical error rather than a logical or producer placeholder");
      assert.equal(rustTargetTypeRefEquals(selected.physical.source.error, error), true,
        "the adapter and invoked source agree on their physical error identity");
      if (rustUninhabitedError(error)) pureCount++;
      else failedCount++;
      selectedCount++;
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selectedCount >= 2, true, "both original arity adaptations retain their owner contracts");
  assert.equal(pureCount > 0, true, "the pure source retains its uninhabited error");
  assert.equal(failedCount > 0, true, "the throwing source retains its inhabited error");
});

test("returned native callback calls publish the bound observer and resolver error before sealing", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    function make<Part>(done: (value: Part) => void, value: Part): () => void {
      return () => { done(value); };
    }
    function wrap<Value>(value: Value): Promise<Value | number> {
      return new Promise<Value | number>(resolve => {
        const observer = make((actual: Value): void => { void actual; }, value);
        const completion = make(resolve, 7);
        new Set([observer]).forEach(next => { next(); });
        observer();
        completion();
      });
    }
    console.log(await wrap(Promise.resolve(5)));
  ` } });
  const { ast } = program.source;
  const found = new Set();
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const callee = Node_Expression(ast, node);
      const name = callee !== undefined && ast.is.IsIdentifier(callee) ? ast.text(callee) : undefined;
      if (name === "observer" || name === "completion") {
        const selected = program.records.sourceCall.get(node);
        assert.equal(selected !== undefined, true, name + ": the actual call owns its sealed native selection");
        assert.equal(selected.eliminateInfallible, name === "observer", name + ": only the pure actual creation eliminates Infallible");
        assert.equal(name === "observer" ? selected.physicalCallableError === undefined
          : rustTargetTypeRefEquals(selected.physicalCallableError, rustJsValueTargetType()), true,
        name + ": no program-error transport replaces the actual native channel");
        found.add(name);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(found.size, 2, "both independent actual creation channels are checked before publication");
});

for (const surfaces of [[], ["js"]]) {
  test(`higher-order error bindings preserve projected callable leaves (${surfaces[0] ?? "native"})`, () => {
    const context = analyzeRustErrorEffects(`
      type Box = { readonly callback: () => number; readonly other: (value: number) => number };
      function invoke(value: Box): number { return value.callback() + value.other(3); }
      function apply(operation: (value: Box) => number, value: Box): number { return operation(value); }
      export function run(): number { return apply(invoke, { callback: () => 7, other: value => value }); }
    `, { surfaces });
    const nodes = context.sourceStorage.nodes;
    const declaration = name => nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === name);
    const invoke = declaration("invoke");
    const apply = declaration("apply");
    assert.equal(invoke !== undefined && apply !== undefined, true, "the original producer and receiving owner exist");
    const supplied = context.callableValues.native.inputsFor(invoke);
    assert.equal(supplied.length, 2, "both distinct original callable members own implementation inputs");
    const operation = context.callableValues.native.inputsFor(apply).find(input =>
      context.ast.text(context.ast.name(input.subject.node)) === "operation");
    const aggregate = rustCallableProtocol(operation?.carrier)?.parameters[0];
    assert.equal(aggregate !== undefined, true, "the receiving operation has its exact aggregate parameter");
    const call = nodes.find(node => {
      if (!context.ast.is.IsCallExpression(node)) return false;
      const callee = Node_Expression(context.ast, node);
      return callee !== undefined && context.ast.is.IsIdentifier(callee) && context.ast.text(callee) === "apply";
    });
    assert.equal(call !== undefined, true, "the original checked apply invocation owns this binding");
    const effects = context.records.errorEffects.get(apply);
    assert.equal(effects !== undefined, true, "the receiving owner publishes its actual error effects");
    const selection = createRustSourceErrorEffectSelection({ context });
    assert.equal(selection.register(effects.nativeErrors), true, "the real higher-order error channels are registered");
    const bindings = selection.bindingsFor(call, apply, effects.nativeErrors.map(error => error.errorType));
    assert.equal(bindings !== undefined, true, "the actual source invocation binds both projected inputs");
    for (const input of supplied) {
      assert.equal(input.subject.projection.length, 1, "the original member path is retained");
      const component = input.subject.projection[0];
      const name = context.ast.text(context.ast.name(component.declaration));
      const bound = bindings.types.get(input.implementation.identity);
      assert.equal(bound !== undefined, true, `${name}: the original implementation has its selected leaf`);
      assert.equal(rustTargetTypeRefEquals(bound, aggregate), false, `${name}: the aggregate never replaces its callable leaf`);
      const signature = rustCallablePhysicalSignature(bound);
      assert.equal(signature !== undefined, true, `${name}: the native implementation has a Result invocation signature`);
      assert.equal(signature.parameters.length, name === "callback" ? 0 : 1, `${name}: sibling signatures stay distinct`);
    }
  });

  test(`higher-order error bindings use physical implementations without changing logical slots (${surfaces[0] ?? "native"})`, () => {
    const context = analyzeRustErrorEffects(`
      function invoke(callback: () => number): number { return callback(); }
      function apply(operation: (callback: () => number) => number, callback: () => number): number {
        return operation(callback);
      }
      export function run(): number { return apply(invoke, () => 7); }
    `, { surfaces });
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    context.sourceFiles.forEach(visit);
    const declaration = name => nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === name);
    const invoke = declaration("invoke");
    const apply = declaration("apply");
    assert.equal(invoke !== undefined && apply !== undefined, true, "both original declarations are selected");
    const inputs = context.callableValues.native.inputsFor(apply);
    const operation = inputs.find(input => context.ast.text(context.ast.name(input.subject.node)) === "operation");
    const invokedInput = context.callableValues.native.inputsFor(invoke)[0];
    assert.equal(operation !== undefined && invokedInput !== undefined, true, "both original implementation binders exist");
    const logical = rustCallableProtocol(operation.carrier)?.parameters[0];
    const physical = logical === undefined ? undefined : rustCallablePhysicalCarrier(logical);
    assert.equal(logical?.kind === "target-named" && logical.genericArguments.length === 4, true,
      "the receiving slot retains its logical four-argument callable contract");
    assert.equal(physical !== undefined && rustCallablePhysicalSignature(physical) !== undefined, true,
      "the canonical physical implementation has its exact Result invocation signature");
    const call = nodes.find(node => context.ast.is.IsCallExpression(node) &&
      context.ast.text(Node_Expression(context.ast, node)) === "apply");
    assert.equal(call !== undefined, true, "the source apply invocation is selected");
    const effects = context.records.errorEffects.get(apply);
    assert.equal(effects !== undefined, true, "the actual callee publishes its source error effects");
    const selection = createRustSourceErrorEffectSelection({ context });
    assert.equal(selection.register(effects.nativeErrors), true, "the original callee error channels are registered");
    const bindings = selection.bindingsFor(call, apply, effects.nativeErrors.map(error => error.errorType));
    assert.equal(bindings !== undefined, true, "the actual source invocation binds its native inputs");
    assert.equal(bindings.types.has(invokedInput.implementation.identity), true,
      "the supplied producer's own callback implementation is selected");
    assert.equal(rustTargetTypeRefEquals(bindings.types.get(invokedInput.implementation.identity), physical), true,
      "the implementation binder receives the physical carrier rather than the logical slot contract");
    assert.equal(rustTargetTypeRefEquals(bindings.types.get(invokedInput.implementation.identity), logical), false,
      "the original logical ABI is never substituted as a physical implementation");
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`generic capture error completion stays closed through source forwarding (${surfaces[0] ?? "native"})`, () => {
    const current = fixture(`
      type Identity = <Value>(value: Value) => Value;
      function first(left: () => number): Identity {
        return <Value>(value: Value): Value => { left(); return value; };
      }
      function second(right: () => string): Identity {
        return <Value>(value: Value): Value => { right(); return value; };
      }
      function run(): void {
        const left = first(() => 1);
        const right = second((): string => { throw new Error("original"); });
        left<number>(7);
        right<string>("exact");
      }
      function forward(): void { run(); }
      function entry(): void { forward(); }
      entry();
    `, { surfaces });
    const { ast, records } = current.context;
    for (const name of ["run", "forward", "entry"]) {
      const declaration = current.producer(name)?.declaration;
      assert.equal(declaration !== undefined, true, name + ": the actual source declaration exists");
      const effects = records.errorEffects.get(declaration);
      assert.equal(effects !== undefined, true, name + ": completed source errors are published");
      let inhabited = effects.localErrors;
      for (const error of effects.nativeErrors) {
        const normalized = normalizeRustErrorType(error.errorType, current.input, declaration);
        assert.equal(normalized !== undefined, true, name + ": completed producer errors normalize exactly");
        assert.equal(rustTargetGenericReferences(normalized, "metadata").typeIdentities.length, 0,
          name + ": factory implementation parameters never escape their bound creation");
        inhabited ||= !rustUninhabitedError(normalized);
      }
      assert.equal(inhabited, true, name + ": the original throwing callback is never invented infallible");
    }
    const input = current.native.inputsFor(current.producer("first").declaration)[0];
    const unbound = rustNativeCallableErrorType(input, input.implementation, "invocation", []);
    const entryCall = ast.statements(current.context.sourceFiles[0])
      .find(statement => ast.is.IsExpressionStatement(statement));
    const invocation = Node_Expression(ast, entryCall);
    assert.equal(invocation !== undefined && ast.is.IsCallExpression(invocation), true,
      "the original entry invocation is selected");
    assert.equal(unbound !== undefined, true, "the actual factory owns its unbound native error channel");
    const selection = createRustSourceErrorEffectSelection({ context: current.context });
    const errors = [{ identity: "direct-unbound-native-input", errorType: unbound }];
    assert.equal(selection.register(errors), true, "the exact non-deferred native channel is registered");
    const deferred = { ...errors[0], identity: "completion-owned-native-input" };
    assert.equal(selection.pending(deferred, () => errors[0], "completed"), true,
      "the existing completion owner retains its exact channel identity");
    assert.equal(selection.bindingCarriersFor([deferred]).length, 0,
      "completion-owned errors bind only after their existing completion");
    assert.equal(selection.bindingCarriersFor(errors).length, 1,
      "the identical carrier under a non-deferred identity still requires binding");
    assert.equal(selection.bindingsFor(invocation, current.producer("entry").declaration,
      selection.bindingCarriersFor(errors)) === undefined, true,
      "only completion-owned channels defer binding; an unrelated unbound input remains refused");
  });
}

test("native declaration error demand removes only template-proven impossible channels and retains Result ABI", () => {
  const current = fixture(nativeCallbackParametersSource, { surfaces: [] });
  const declaration = current.producer("run").declaration;
  const effects = current.input.records.errorEffects.get(declaration);
  assert.equal(effects.nativeErrors.length, 2, "original source channel identities are not erased");
  const selected = selectRustErrorRegion(declaration, effects, { ...current.input, promiseBodies: { objects: new Map() } }, false);
  assert.equal(selected.kind, "resolved", "the canonical declaration owns its exact physical error selection");
  assert.equal(selected.value.kind, "native", "the original native Result call ABI is retained");
  assert.equal(selected.value.sources.length, 0, "both actual impossible declaration channels need no enum variants");
  const error = current.input.producers.errorFor(declaration, "invoke");
  const normalized = normalizeRustErrorType(error, current.input);
  assert.equal(normalized?.id, "rust.core.Infallible", "native producer and declaration choose the identical error carrier");
  const generic = current.producer("consume").declaration;
  const genericError = normalizeRustErrorType(current.input.producers.errorFor(generic, "invoke"), current.input);
  assert.equal(genericError !== undefined && genericError.id !== "rust.core.Infallible", true,
    "an unbound callback error remains an actual independent generic channel");
  const joined = rustNativeErrorJoinTargetType("/native-template.ts", [normalized, normalized]);
  assert.equal(rustNativeErrorJoinReference(normalizeRustErrorType(joined, current.input))?.errors.length, 2,
    "a previously selected generic join is never collapsed merely from bound Infallible arguments");
});

test("native body errors normalize independently from the single JS Promise rejection boundary", () => {
  const current = fixture();
  const pure = ["pureLeft", "pureRight"].map(name => normalizeRustErrorType(current.error(name), current.input));
  assert.equal(pure.every(carrier => carrier?.id === "rust.core.Infallible"), true);
  assert.equal(rustTargetTypeRefEquals(...pure), true);
  const failed = ["failLeft", "failRight"].map(name => normalizeRustErrorType(current.error(name), current.input));
  assert.equal(failed.every(carrier => carrier?.errorOwner?.kind === "physical" && carrier.errorOwner.domain === "project"), true);
  assert.equal(failed.every(carrier => rustTargetTypeRefEquals(carrier, failed[0])), true);
  assert.equal(rustTargetTypeRefEquals(current.error("failLeft"), current.error("failRight")), false,
    "distinct producers stay distinct symbolic references before normalization");
  const forwarded = normalizeRustErrorType(current.error("forwarded"), current.input);
  assert.equal(rustTargetTypeRefEquals(forwarded, rustJsValueTargetType()), true,
    "synchronous forwarding retains the concrete Promise object's one JS rejection carrier");
  const completion = current.input.producers.invocationResultFor(current.producer("failLeft").declaration);
  const output = current.input.records.asyncFunction.get(current.producer("failLeft").declaration)?.outputCarrier;
  assert.equal(output !== undefined, true, "the checked async declaration owns its actual native payload selection");
  assert.equal(rustTargetTypeRefEquals(output, rustStringTargetType()), true,
    "the authored Promise<string> payload uses ordinary native String, not the JS UTF-16 wrapper");
  const selected = normalizeRustErrorType(completion, current.input);
  assert.equal(selected?.id, "rust.js.JsPromise");
  assert.equal(selected.genericArguments.length, 1, "the actual Promise object has only its payload argument");
  assert.equal(selected.genericArguments[0].kind, "type", "the payload is a native type argument");
  assert.equal(rustTargetTypeRefEquals(completion.genericArguments[0].type, output), true,
    "the actual Promise producer carries the checked native payload, not a guessed JS storage carrier");
  assert.equal(rustTargetTypeRefEquals(selected.genericArguments[0].type, output), true,
    "Promise output stays separate from exact native body errors and the shared JS rejection carrier");
});

test("logical errors require a declaration-local owner and foreign physical owners never fall back to ambient scope", () => {
  const current = fixture();
  const logical = rustProgramErrorTargetType();
  assert.equal(normalizeRustErrorType(logical, current.input) === undefined, true);
  const declaration = current.producer("failLeft").declaration;
  const owner = selectRustPhysicalProgramErrorOwner(declaration, current.input);
  assert.equal(owner?.kind, "physical");
  assert.equal(rustTargetTypeRefEquals(normalizeRustErrorType(logical, current.input, declaration), rustProgramErrorTargetType(owner)), true);
  const foreign = rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "foreign" });
  assert.equal(normalizeRustErrorType(foreign, current.input, declaration) === undefined, true);
  const missing = { ...current.input, components: { ...current.input.components, componentForFile: () => undefined } };
  assert.equal(normalizeRustErrorType(current.error("failLeft"), missing) === undefined, true);
});

test("normalization rejects incomplete producer effects, recursive aliases and excessive work rather than inventing purity", () => {
  const current = fixture();
  const declaration = current.producer("failLeft").declaration;
  const carrier = current.error("failLeft");
  for (const effects of [undefined, { localErrors: false, nativeErrors: [{ identity: "cycle", errorType: carrier }] }]) {
    const input = { ...current.input, records: createRustRecordFixture({
errorEffects: { get: (node) => node === declaration
    ? effects : current.input.records.errorEffects.get(node) }}, current.input.records) };
    assert.equal(normalizeRustErrorType(carrier, input) === undefined, true);
  }
  assert.equal(rustProducerErrorReference(carrier).identity.length > 0, true);
  assert.equal(normalizeRustErrorType({ kind: "tuple", elements: Array.from({ length: 4097 }, () =>
    ({ kind: "source-primitive", name: "int32" })) }, current.input) === undefined, true);
});
