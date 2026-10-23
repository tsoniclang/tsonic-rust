import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, sourceProjectFiles } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createRustSession, checkRustSession } from "../../helpers/rust-session.mjs";
import { createRustRetainedEnvironmentQueries } from "../../../dist/analysis/callables/retained-environment-shapes.js";
import { closeRustRetainedParameter, rustRetainedEnvironment } from "../../../dist/analysis/callables/retained-values.js";
import { rustHasOpenOwnedStorage } from "../../../dist/policy/ownership/retained-storage.js";
import { emptyRustLifetimeIndex } from "../../../dist/target-model/lifetimes/index.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("complete source capture carriers preserve the canonical generic and frame environment normalization", () => {
  const captured = { kind: "type-parameter", identity: "captured:value", name: "Captured" };
  const nested = { kind: "type-parameter", identity: "captured:nested", name: "Nested" };
  const parameter = { kind: "type-parameter", identity: "method:value", name: "Value" };
  const region = { kind: "parameter", identity: "source:Region", name: "Region" };
  const carriers = [{ kind: "reference", mutable: false, referent: captured, lifetime: region },
    { kind: "tuple", elements: [nested, captured] }];
  const reduced = [captured, nested];
  const origin = { fileName: "/src/index.ts", declarationIdentity: "source:retained-method" };
  const generic = rustGenericCallableTargetType([parameter], [parameter], parameter, origin, carriers);
  const previousGeneric = rustGenericCallableTargetType([parameter], [parameter], parameter, origin, reduced);
  assert.equal(generic !== undefined && rustTargetTypeRefEquals(generic, previousGeneric), true,
    "the existing generic signature owner retains exactly the same ordered free parameters");
  const owner = { kind: "lexical", origin };
  const frame = rustFrameCallableTargetType([parameter], parameter, owner, carriers);
  const previousFrame = rustFrameCallableTargetType([parameter], parameter, owner, reduced);
  assert.equal(frame !== undefined && rustTargetTypeRefEquals(frame, previousFrame), true,
    "the existing frame signature owner performs the same normalization without losing source capture evidence early");
});

function fixture(text, configure = input => input, maximumSteps) {
  const checked = checkRustSession(createRustSession({ surfaces: ["js"], files: { "index.ts": text } }));
  const source = createTargetSourceProgram(checked);
  const sourceStorage = createSourceStorageQuery(source, sourceProjectFiles(checked));
  assert.equal(sourceStorage.failureReason(), undefined);
  // The analysis host passes every native participating node; the source storage inventory is that set here.
  const input = configure({ source, sourceStorage, sourceLifetimes: emptyRustLifetimeIndex });
  const queries = createRustRetainedEnvironmentQueries(input, maximumSteps);
  const declarations = new Map(sourceStorage.nodes.filter(node => source.ast.is.IsFunctionDeclaration(node))
    .map(node => [source.ast.text(source.ast.name(node)), node]));
  return { ...input, queries, declarations };
}

const suspended = `
export async function outer(callback: () => number, unused: () => number): Promise<number> {
  function helper(): number { return callback(); }
  return helper();
}
`;

test("suspended retention uses checked nested-function capture evidence and excludes unused parameters", () => {
  const { source, queries, declarations } = fixture(suspended);
  const owner = declarations.get("outer");
  const parameters = source.ast.parameters(owner);
  const uses = source.navigation.parameterUseSummary(parameters[0]);
  assert.equal(uses.captured, true);
  assert.equal(uses.uses.some(use => use.captured && use.role === "call-target"), true);
  const selected = queries.environmentFor(owner);
  assert.equal(selected.kind, "selected");
  assert.equal(selected.environment.inputs.length, 1);
  assert.equal(selected.environment.inputs[0].declaration === parameters[0], true);
  assert.equal(queries.suspendedParametersFor(owner)[0] === parameters[0], true);
  assert.equal(Object.isFrozen(selected.environment.inputs), true);
});

for (const [name, body] of [
  ["async method", "return { async read(): Promise<Value> { return value; } };"],
  ["native method", "return { read(): Value { return value; } };"],
  ["stored callback", "return { read: (): Value => value };"],
  ["copied method", "const original = { read(): Value { return value; } }; return { label: 'copy', ...original };"],
  ["nested method", "return { nested: { read(): Value { return value; } } };"],
  ["optional method", "return selected ? { read(): Value { return value; } } : {};"],
  ["tuple callback", "return [(): Value => value] as const;"],
  ["array callback", "return [(): Value => value];"],
]) {
  test(`returned ${name} retains its actual source capture before signature selection`, () => {
    const { source, queries, declarations } = fixture(`
export function make<Value>(value: Value, unused: Value, selected: boolean) { ${body} }
`);
    const owner = declarations.get("make");
    const parameters = source.ast.parameters(owner);
    const selection = queries.environmentFor(owner);
    assert.equal(selection.kind, "selected", `${name}: a returned stored capture requires its environment`);
    assert.equal(selection.environment.inputs.length, 1, `${name}: no unrelated or control-only input is retained`);
    assert.equal(selection.environment.inputs[0].declaration === parameters[0], true, `${name}: the original captured input owns the lifetime`);
    assert.equal(selection.environment.lifetime.kind, "parameter", `${name}: no static lifetime is invented`);
    assert.equal(queries.environmentFor(owner) === selection, true, `${name}: one immutable selection is reused`);
  });
}

test("returned method captures preserve the producer activation through a source factory", () => {
  const { source, queries, declarations } = fixture(`
function wrap<Value>(captured: Value) { return { read(): Value { return captured; } }; }
export function make<Value>(value: Value, unused: Value) { return wrap(value); }
`);
  for (const name of ["wrap", "make"]) {
    const owner = declarations.get(name);
    const selection = queries.environmentFor(owner);
    assert.equal(selection.kind, "selected", `${name}: the exact returned source construction remains retained`);
    assert.equal(selection.environment.inputs.length, 1, `${name}: one actual activation-owned input`);
    assert.equal(selection.environment.inputs[0].declaration === source.ast.parameters(owner)[0], true,
      `${name}: the factory's formal is rebound to the caller's actual input`);
  }
});

test("returned source method traversal stays bounded and never invokes an accessor", () => {
  const source = `export function make<Value>(value: Value) { return { read(): Value { return value; } }; }`;
  const bounded = fixture(source, undefined, 2);
  assert.equal(bounded.queries.environmentFor(bounded.declarations.get("make")).kind, "unresolved",
    "a missing finite component proof never becomes static");
  const accessor = fixture(`export function make(unused: number) { return { get value(): number { return 1; } }; }`, input => ({
    ...input, sourceStorage: { ...input.sourceStorage, subject(node, kind, projection) {
      assert.equal(projection?.some(component => component.declaration !== undefined &&
        input.source.ast.is.IsGetAccessorDeclaration(component.declaration)) === true, false,
      "source retention never manufactures an accessor invocation");
      return input.sourceStorage.subject(node, kind, projection);
    } },
  }));
  assert.equal(accessor.queries.environmentFor(accessor.declarations.get("make")).kind, "none",
    "an unused input is not retained by evaluating a getter");
});

test("retention respects the canonical opaque invocation leaf instead of traversing its advertised native members", () => {
  const current = fixture(`
interface NativeResult { next: NativeResult; read(): number; }
declare function native(value: number): NativeResult;
export function make(unused: number): NativeResult { return native(1); }
`, input => ({ ...input, sourceStorage: { ...input.sourceStorage, subject(node, kind, projection) {
    assert.equal(projection?.length > 0 && input.source.ast.is.IsCallExpression(node), false,
      "an opaque native result is not a source record allocation");
    return input.sourceStorage.subject(node, kind, projection);
  } } }));
  assert.equal(current.sourceStorage.boundaries.some(boundary => boundary.kind === "opaque-invocation"), true,
    "the actual source transport declares the native result opaque");
  assert.equal(current.queries.environmentFor(current.declarations.get("make")).kind, "none",
    "the unused source input is not retained through an invented native field walk");
});

test("retention distinguishes type-only parameter uses from evaluated default and body uses", () => {
  const { source, queries, declarations } = fixture(`
export async function outer(typeOnly: () => number, callback: () => number, value = callback()): Promise<number> {
  type Signature = typeof typeOnly;
  return value;
}
`);
  const owner = declarations.get("outer");
  const parameters = source.ast.parameters(owner);
  const retained = queries.suspendedParametersFor(owner);
  assert.equal(retained.length, 2);
  assert.equal(retained[0] === parameters[1], true);
  assert.equal(retained[1] === parameters[2], true);
});

test("declaration use evidence and lexical storage queries are memoized independently of selected carriers", () => {
  let parameterQueries = 0;
  let producerQueries = 0;
  const context = fixture(`${suspended}
export function returned(callback: () => number): () => number { return () => callback(); }
`, input => ({ ...input, source: { ...input.source, navigation: { ...input.source.navigation,
    parameterUseSummary(parameter) { parameterQueries += 1; return input.source.navigation.parameterUseSummary(parameter); },
  } }, sourceStorage: { ...input.sourceStorage,
    storageProducersFor(...arguments_) { producerQueries += 1; return input.sourceStorage.storageProducersFor(...arguments_); },
  } }));
  const outer = context.declarations.get("outer");
  const returned = context.declarations.get("returned");
  const first = context.queries.environmentFor(outer);
  const second = context.queries.environmentFor(returned);
  assert.equal(first.kind, "selected");
  assert.equal(second.kind, "selected");
  for (let index = 0; index < 1_000; index += 1) {
    assert.equal(context.queries.environmentFor(outer) === first, true);
    assert.equal(context.queries.environmentFor(returned) === second, true);
  }
  assert.equal(parameterQueries, 2);
  assert.equal(producerQueries, 1);
  const scalar = { kind: "source-primitive", name: "float64" };
  const callback = rustCallableTargetType([], scalar);
  const policy = { ...context, ast: context.source.ast, retainedEnvironments: context.queries };
  assert.equal(rustRetainedEnvironment(outer, [scalar, scalar], policy).kind, "none");
  assert.equal(rustRetainedEnvironment(outer, [callback, callback], policy).kind, "selected");
  assert.equal(parameterQueries, 2);
});

test("retention fails closed on missing checked uses and finite work exhaustion without widening lifetimes", () => {
  for (const maximumSteps of [0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, 1]) {
    const { queries, declarations } = fixture(suspended, undefined, maximumSteps);
    const owner = declarations.get("outer");
    const selected = queries.environmentFor(owner);
    assert.equal(selected.kind, "unresolved", String(maximumSteps));
    assert.equal(queries.environmentFor(owner) === selected, true);
  }
  const { queries, declarations } = fixture(suspended, input => ({ ...input,
    source: { ...input.source, navigation: { ...input.source.navigation, parameterUseSummary: () => undefined } },
  }));
  assert.equal(queries.environmentFor(declarations.get("outer")).kind, "unresolved");
});

test("retained owned inputs bind only their environment and preserve nested invocation and reference contracts", () => {
  const context = fixture(`
export function retain(callback: (inner: () => number) => () => number, unused: () => number): (inner: () => number) => () => number { return callback; }
`);
  const owner = context.declarations.get("retain");
  const parameters = context.source.ast.parameters(owner);
  const environment = context.queries.environmentFor(owner);
  assert.equal(environment.kind, "selected");
  const policy = { ...context, ast: context.source.ast, retainedEnvironments: context.queries };
  const scalar = { kind: "source-primitive", name: "float64" };
  const nested = rustCallableTargetType([], scalar);
  const callback = rustCallableTargetType([nested], nested);
  const selected = closeRustRetainedParameter(parameters[0], callback, policy);
  const protocol = rustCallableProtocol(selected);
  assert.equal(protocol !== undefined, true);
  assert.equal(protocol.lifetime === environment.environment.lifetime, true);
  assert.equal(protocol.parameters[0] === nested, true, "nested input contract retains its independent lifetime");
  assert.equal(protocol.result === nested, true, "nested output contract retains its independent lifetime");
  assert.equal(closeRustRetainedParameter(parameters[1], callback, policy) === callback, true,
    "an unretained input receives no generated lifetime constraint");
  const explicit = { kind: "parameter", identity: "authored-region", name: "region" };
  const authored = rustCallableTargetType([], scalar, explicit);
  const reference = { kind: "reference", mutable: false, referent: callback, lifetime: explicit };
  assert.equal(closeRustRetainedParameter(parameters[0], authored, policy) === authored, true);
  assert.equal(closeRustRetainedParameter(parameters[0], reference, policy) === reference, true,
    "an explicit reference is not turned into owned retained storage");
  const pair = { kind: "tuple", elements: [callback, reference] };
  const closedPair = closeRustRetainedParameter(parameters[0], pair, policy);
  assert.equal(closedPair.kind, "tuple");
  assert.equal(rustCallableProtocol(closedPair.elements[0]).lifetime === environment.environment.lifetime, true);
  assert.equal(closedPair.elements[1] === reference, true);
});

test("retained parameter closure rejects absent owner evidence instead of assigning static storage", () => {
  const context = fixture("export function retain(callback: () => number): () => number { return callback; }");
  const owner = context.declarations.get("retain");
  const parameter = context.source.ast.parameters(owner)[0];
  const callback = rustCallableTargetType([], { kind: "source-primitive", name: "float64" });
  const policy = { ...context, ast: context.source.ast,
    retainedEnvironments: { ...context.queries, environmentFor: () => ({ kind: "unresolved", reason: "test evidence unavailable" }) } };
  assert.equal(closeRustRetainedParameter(parameter, callback, policy) === undefined, true);
  assert.equal(closeRustRetainedParameter(owner, callback, policy) === undefined, true);
});

test("generic inputs and explicit callable contracts do not demand generated environment evidence", () => {
  const context = fixture("export function identity<T>(value: T): T { return value; }");
  const owner = context.declarations.get("identity");
  const parameter = context.source.ast.parameters(owner)[0];
  let queries = 0;
  const policy = { ...context, ast: context.source.ast, retainedEnvironments: {
    ...context.queries, environmentFor() {
      queries += 1;
      return { kind: "unresolved", reason: "No callable environment was requested." };
    },
  } };
  const generic = { kind: "type-parameter", identity: "authored-T", name: "T" };
  const scalar = { kind: "source-primitive", name: "float64" };
  const callback = rustCallableTargetType([], scalar, { kind: "parameter", identity: "authored-region", name: "region" });
  const values = [generic, { kind: "tuple", elements: [generic, callback] }, callback,
    { kind: "function-pointer", args: [rustCallableTargetType([], scalar)], result: scalar }];
  for (const [index, carrier] of values.entries()) {
    assert.equal(closeRustRetainedParameter(parameter, carrier, policy) === carrier, true, String(index));
  }
  assert.equal(queries, 0);
});

test("native factory signatures retain their generic types without demanding a closure environment", () => {
  const context = fixture("export function identity<T>(value: T): T { return value; }");
  const owner = context.declarations.get("identity");
  const parameter = context.source.ast.parameters(owner)[0];
  const generic = { kind: "type-parameter", identity: "authored-T", name: "T" };
  const callback = rustCallableTargetType([generic], generic);
  const factory = rustStructuralObjectTargetType("/src/index.ts", [{ sourceName: "accepts", type: callback,
    presence: "required", readonly: true, method: true }], "reference", callback);
  const policy = { ...context, ast: context.source.ast, retainedEnvironments: {
    ...context.queries, environmentFor() { assert.fail("native dispatch signatures do not request return-storage evidence"); },
  } };
  assert.equal(rustHasOpenOwnedStorage(factory), false);
  assert.equal(closeRustRetainedParameter(parameter, factory, policy) === factory, true);
  assert.equal(rustRetainedEnvironment(owner, [factory], policy).kind, "none");
});

test("a real retained callback field closes without changing same-carrier native dispatch signatures", () => {
  const context = fixture("export function retain(callback: () => number): () => number { return callback; }");
  const owner = context.declarations.get("retain");
  const parameter = context.source.ast.parameters(owner)[0];
  const callback = rustCallableTargetType([], { kind: "source-primitive", name: "float64" });
  const factory = rustStructuralObjectTargetType("/src/index.ts", [
    { sourceName: "invoke", type: callback, presence: "required", readonly: true, method: true },
    { sourceName: "stored", type: callback, presence: "required", readonly: true },
  ], "reference", callback);
  const policy = { ...context, ast: context.source.ast, retainedEnvironments: context.queries };
  const environment = context.queries.environmentFor(owner);
  const closed = closeRustRetainedParameter(parameter, factory, policy);
  const native = rustStructuralObjectCarrierValue(closed);
  assert.equal(rustHasOpenOwnedStorage(factory), true);
  assert.equal(native.construction === callback, true);
  assert.equal(native.fields[0].type === callback, true);
  assert.equal(rustCallableProtocol(native.fields[1].type).lifetime === environment.environment.lifetime, true);
  const unavailable = { ...policy, retainedEnvironments: {
    ...context.queries, environmentFor: () => ({ kind: "unresolved", reason: "required owner binding missing" }),
  } };
  assert.equal(closeRustRetainedParameter(parameter, factory, unavailable) === undefined, true);
});
