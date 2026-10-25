import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRustProviderOperation } from "../../../dist/policy/operations/provider-selection.js";
import { instantiateProviderOperationTemplate } from "../../../dist/policy/types/callables/provider-templates.js";
import { rustBorrowedStringTypeParameterNames } from "../../../dist/policy/types/callables/provider-argument-shape.js";
import {
  mergeProviderDeclarationIdentities,
  resolveSelectedProviderDeclaration,
  selectedCallProviderDeclaration,
  selectedCallProviderDomain,
} from "../../../dist/policy/identities/selected-source.js";
import { rustCallScopedElisionLifetime } from "../../../dist/target-model/lifetimes/index.js";
import { selectRustCheckedOperator } from "../../../dist/analysis/operations/members/operators.js";
import { rustOptionTargetType, rustAbsenceTargetType } from "../../../dist/target-model/types/index.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { rustUninhabitedError } from "../../../dist/policy/conversions/callable-physical.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { nodejsCapability } from "../../helpers/rust-session.mjs";

const unit = { kind: "tuple", elements: [] };

test("uninhabited native errors retain exact identity and reject generic or foreign payloads", () => {
  assert.equal(rustUninhabitedError({ kind: "target-named", id: rustInfallibleTargetId }), true, "native builtin identity");
  assert.equal(rustUninhabitedError(rustNamedTargetType(rustInfallibleTargetId, "core::convert::Infallible")), true,
    "the canonical named native declaration is uninhabited");
  assert.equal(rustUninhabitedError(rustNamedTargetType(rustInfallibleTargetId, "core::convert::Infallible",
    [{ kind: "type", type: unit }])), false, "an altered native generic signature is not Infallible");
  assert.equal(rustUninhabitedError(rustNamedTargetType("fixture.Failure", "Infallible")), false,
    "the native spelling does not substitute for declaration identity");
  assert.equal(rustUninhabitedError({ kind: "target-named", id: rustInfallibleTargetId,
    genericArguments: [{ kind: "type", type: unit }] }), false, "a generic builtin is not Infallible");
});

test("provider invocation domains preserve aliases and distinguish returned callable signatures", () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const callable = { kind: "function", id: "fixture.callback", parameters: [{ name: "value", type: integer }], returnType: integer };
  const provider = createRustProviderPackage({ id: "callable-domains", version: "1.0.0", displayName: "Callable domains",
    crates: [], modules: [{ moduleSpecifier: "test:callable-domains", providerModuleId: "test.callable-domains", exports: [{
      id: "fixture.makeCallback", name: "makeCallback", kind: "function", signatures: [{
        id: "fixture.makeCallback()", parameters: [], returnType: callable,
      }],
    }, { id: "fixture.exported", name: "exported", kind: "value", type: { ...callable, id: "fixture.exported.call" } }] }],
    operations: [{ exportId: "fixture.makeCallback", operationKind: "method",
      target: { form: "call", path: "fixture::make_callback" }, parameterCarriers: [],
      resultCarrier: rustCallableTargetType([integer], integer) }, {
      exportId: "fixture.exported", operationKind: "property", target: { form: "path", path: "fixture::exported" },
      parameterCarriers: [], resultCarrier: rustCallableTargetType([integer], integer),
    }],
  });
  const context = analyzeRustErrorEffects(`
    import { makeCallback, exported } from "test:callable-domains";
    import type { int32 } from "@tsonic/core/types.js";
    export function run(value: int32): int32 {
      const factory = makeCallback;
      const direct = makeCallback();
      const callback = factory();
      const alias = callback;
      return direct(value) + callback(value) + alias(value) + exported(value);
    }
  `, { packages: [provider] });
  const expected = new Map([["makeCallback", "operation"], ["factory", "operation"], ["direct", "value"],
    ["callback", "value"], ["alias", "value"], ["exported", "value"]]);
  let visited = 0;
  for (const node of context.sourceStorage.nodes) {
    if (!context.ast.is.IsCallExpression(node)) continue;
    const name = context.ast.text(context.ast.as.AsCallExpression(node)?.Expression);
    if (!expected.has(name)) continue;
    const semantics = context.semanticsFor(node);
    const source = semantics.operations.call(node);
    assert.equal(source !== undefined, true, name);
    const request = { source, sourceSelectedDeclaration: semantics.declarations.signatureDeclaration(source.selectedSignature) };
    const selected = selectedCallProviderDeclaration(request, context);
    assert.equal(selected.kind, "selected", name);
    const operation = selectRustProviderOperation(context.providerSemantics.operations, selected.identity, "method");
    assert.equal(selectedCallProviderDomain(request, selected.identity, operation, context), expected.get(name), name);
    assert.equal(selectedCallProviderDomain(request, { ...selected.identity, signatureId: "foreign.signature" }, operation, context), undefined,
      `${name}: a foreign signature never supplies operation evidence`);
    assert.equal(selectedCallProviderDomain(request, { ...selected.identity, providerVersion: "different" }, operation, context), undefined,
      `${name}: a foreign declaration document never supplies operation evidence`);
    visited += 1;
  }
  assert.equal(visited, expected.size, "every original checked direct, aliased and returned-callable use is observed");
});

test("explicit native invocation rows select callable intersections without a runtime Fn carrier", async () => {
  const context = analyzeRustErrorEffects(`
    import { realpathSync as resolvePath } from "node:fs";
    import { Buffer } from "node:buffer";
    export function run(): void {
      resolvePath(".");
      const path = Buffer.from(".");
      resolvePath(path);
      resolvePath(".", { encoding: "buffer" });
      resolvePath(path, { encoding: "buffer" });
      resolvePath.native(".");
      resolvePath.native(path);
      resolvePath.native(".", { encoding: "buffer" });
      resolvePath.native(path, { encoding: "buffer" });
    }
  `, { capabilities: [await nodejsCapability()] });
  const observed = new Set();
  let calls = 0;
  for (const node of context.sourceStorage.nodes) {
    if (!context.ast.is.IsCallExpression(node)) continue;
    const semantics = context.semanticsFor(node);
    const source = semantics.operations.call(node);
    if (source === undefined) continue;
    const request = { source, sourceSelectedDeclaration: semantics.declarations.signatureDeclaration(source.selectedSignature) };
    const selected = selectedCallProviderDeclaration(request, context);
    if (selected.kind !== "selected" || selected.identity.moduleSpecifier !== "node:fs") continue;
    const operation = selectRustProviderOperation(context.providerSemantics.operations, selected.identity, "method");
    assert.equal(operation.kind, "selected", "each checked native invocation has one exact provider row");
    assert.equal(operation.row.signatureId, selected.identity.signatureId,
      "every overload retains its exact checked signature identity");
    assert.equal(selectedCallProviderDomain(request, selected.identity, operation, context), "operation",
      "a native callable-object operation is not a runtime Fn invocation");
    assert.equal(selectedCallProviderDomain(request, { ...selected.identity, signatureId: "foreign.signature" }, operation, context), undefined,
      "an explicit native row cannot repair a foreign checked signature");
    assert.equal(selectedCallProviderDomain(request, { ...selected.identity, providerVersion: "foreign.version" }, operation, context), undefined,
      "an explicit native row cannot repair a foreign declaration document");
    const duplicate = selectRustProviderOperation([...context.providerSemantics.operations, operation.row], selected.identity, "method");
    assert.equal(duplicate.kind, "ambiguous", "duplicate exact native rows remain an ambiguity");
    assert.equal(selectedCallProviderDomain(request, selected.identity, duplicate, context), "operation",
      "a native ambiguity cannot be hidden by a runtime-value route");
    if (selected.identity.memberId === undefined) {
      const missing = selectRustProviderOperation(context.providerSemantics.operations.filter(row =>
        row.operationKind !== "method" || row.signatureId !== selected.identity.signatureId), selected.identity, "method");
      assert.equal(missing.kind, "missing", "a sibling overload is not an exact native invocation");
      assert.equal(selectedCallProviderDomain(request, selected.identity, missing, context), "value",
        "a function type without a native operation row still needs its actual callable-value ABI");
      const { signatureId: omittedSignature, ...group } = operation.row;
      assert.equal(omittedSignature, selected.identity.signatureId, "the inverse removes only the selected signature identity");
      const grouped = selectRustProviderOperation([group], selected.identity, "method");
      assert.equal(grouped.kind, "selected", "the existing explicit overload-group selector is unchanged");
      assert.equal(selectedCallProviderDomain(request, selected.identity, grouped, context), "value",
        "a group row cannot promote a callable-value signature to a native operation");
      observed.add(selected.identity.signatureId);
    }
    calls += 1;
  }
  assert.equal(calls, 8, "all four native callable-object and four native member overloads retain their identities");
  assert.equal(observed.size, 4, "the complete callable intersection selects every exact overload without a copied type walker");
});

test("provider optional argument inference preserves native carriers and absence", () => {
  const int64 = { kind: "source-primitive", name: "int64" };
  const uint64 = { kind: "source-primitive", name: "uint64" };
  const float64 = { kind: "source-primitive", name: "float64" };
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  const template = {
    kind: "provider-operation", operationId: "acme.optional", operationKind: "method",
    target: { form: "call", path: "acme::optional" }, resultCarrier: unit,
    parameterCarriers: [rustOptionTargetType(parameter)],
    genericParameters: [{ kind: "type", targetIdentity: "Value", sourceName: "Value", defaultArgument: { kind: "type", type: float64 } }],
    isAsync: false, isFallible: false, errorBoundary: "target-runtime",
  };
  for (const carrier of [int64, uint64]) {
    for (const actual of [carrier, rustOptionTargetType(carrier)]) {
      const result = instantiateProviderOperationTemplate(template, { sourceParameterCarriers: [actual] });
      assert.ok(result);
      assert.deepEqual(result.substitutions.types.get("Value"), carrier);
      assert.deepEqual(result.template.parameterCarriers, [rustOptionTargetType(carrier)]);
    }
  }
  for (const absent of [rustAbsenceTargetType()]) {
    const result = instantiateProviderOperationTemplate(template, { sourceParameterCarriers: [absent] });
    assert.deepEqual(result?.substitutions.types.get("Value"), float64);
    assert.equal(instantiateProviderOperationTemplate({ ...template,
      genericParameters: [{ kind: "type", targetIdentity: "Value", sourceName: "Value" }],
    }, { sourceParameterCarriers: [absent] }), undefined);
  }
  assert.equal(instantiateProviderOperationTemplate(template, { sourceParameterCarriers: [undefined] }), undefined);
  assert.equal(instantiateProviderOperationTemplate({ ...template,
    parameterCarriers: [rustOptionTargetType(parameter), parameter],
  }, { sourceParameterCarriers: [int64, uint64] }), undefined);
  const arrayTemplate = { ...template, parameterCarriers: [rustOptionTargetType({ kind: "array", element: parameter })] };
  assert.equal(instantiateProviderOperationTemplate(arrayTemplate, { sourceParameterCarriers: [int64] }), undefined);
});

test("checked operators do not repeat the initialized project declaration scan", () => {
  const context = {
    ast: { kind: () => undefined },
    get sourceFiles() { assert.fail("Operator selection must not traverse the source-file bank"); },
  };
  const options = { sourceTypes: {
    registerSourceFile() { assert.fail("Declaration registration belongs to program initialization"); },
  } };
  for (let index = 0; index < 256; index++) {
    const expression = {};
    const result = selectRustCheckedOperator({ expression, operator: "+", left: {}, right: {} }, context, options);
    assert.equal(result.kind, "accept");
    assert.equal(result.value.operation.targetOperation, "post-check-finalization");
    assert.equal(result.value.provenance.sourceExpression, expression);
  }
});

function row(overrides = {}) {
  return {
    providerPackageId: "acme-store",
    providerId: "tsonic.rust.provider-package.acme-store.binding",
    providerVersion: "1.0.0",
    providerModuleId: "acme.store",
    moduleSpecifier: "@acme/store",
    exportId: "acme.Store",
    memberId: "acme.Store.get",
    operationKind: "method",
    target: { form: "receiver-method", name: "get" },
    resultCarrier: unit,
    ...overrides,
  };
}

function identity(overrides = {}) {
  return {
    providerId: "tsonic.rust.provider-package.acme-store.binding",
    providerVersion: "1.0.0",
    providerModuleId: "acme.store",
    moduleSpecifier: "@acme/store",
    exportId: "acme.Store",
    exportName: "Store",
    memberId: "acme.Store.get",
    memberName: "get",
    ...overrides,
  };
}

test("borrowed native string inference requires an exact ?Sized generic parameter", () => {
  const template = (maybeSized) => ({
    kind: "provider-operation",
    operationId: "acme.borrowed",
    operationKind: "method",
    target: { form: "call", path: "acme::borrowed", argModes: ["ref"] },
    resultCarrier: unit,
    parameterCarriers: [{ kind: "type-parameter", identity: "Q", name: "Q" }],
    genericParameters: [{
      kind: "type",
      sourceName: "Q",
      targetIdentity: "Q",
      ...(maybeSized ? { maybeSized: true } : {}),
    }],
    isAsync: false,
    isFallible: false,
    errorBoundary: "target-runtime",
  });

  assert.deepEqual([...rustBorrowedStringTypeParameterNames(template(false))], []);
  assert.deepEqual([...rustBorrowedStringTypeParameterNames(template(true))], ["Q"]);
});

test("explicit provider arguments bind exact identities rather than equal parameter spellings", () => {
  const left = { kind: "type-parameter", identity: "owner:left:0", name: "Value" };
  const right = { kind: "type-parameter", identity: "owner:right:0", name: "Value" };
  const int32 = { kind: "source-primitive", name: "int32" };
  const string = { kind: "target-named", id: "rust.std.String" };
  const template = {
    kind: "provider-operation", operationId: "acme.exact-binders", operationKind: "method",
    target: { form: "call", path: "acme::exact" },
    resultCarrier: { kind: "tuple", elements: [left, right] }, parameterCarriers: [],
    genericParameters: [left, right].map(parameter => ({
      kind: "type", sourceName: parameter.name, targetIdentity: parameter.identity,
    })), isAsync: false, isFallible: false, errorBoundary: "none",
  };
  const argumentsByIdentity = new Map([
    [left.identity, { kind: "type", type: int32 }],
    [right.identity, { kind: "type", type: string }],
  ]);
  const selected = instantiateProviderOperationTemplate(template, { directGenericArguments: argumentsByIdentity });
  assert.deepEqual(selected?.template.resultCarrier, { kind: "tuple", elements: [int32, string] });
  assert.deepEqual([...selected.substitutions.types], [[left.identity, int32], [right.identity, string]]);
  for (const invalid of [
    new Map([["Value", { kind: "type", type: int32 }]]),
    new Map([["unknown:0", { kind: "type", type: int32 }]]),
    new Map([[left.identity, { kind: "type", type: int32 }]]),
    new Map([[left.identity, { kind: "const", value: { kind: "literal", value: "1" } }]]),
  ]) {
    assert.equal(instantiateProviderOperationTemplate(template, { directGenericArguments: invalid }), undefined);
  }
});

test("exact provider signature identity wins over its explicit overload-group row", () => {
  const group = row();
  const first = row({ signatureId: "acme.Store.get(number)" });
  const second = row({ signatureId: "acme.Store.get(string)" });

  assert.deepEqual(
    selectRustProviderOperation([group, first, second], identity({ signatureId: second.signatureId }), "method"),
    { kind: "selected", row: second },
  );
});

test("an exact selected signature never falls through to a sibling signature", () => {
  const sibling = row({ signatureId: "acme.Store.get(string)" });

  assert.deepEqual(
    selectRustProviderOperation([sibling], identity({ signatureId: "acme.Store.get(number)" }), "method"),
    { kind: "missing" },
  );
});

test("an explicit overload-group row is the only fallback for an unmatched signature", () => {
  const group = row();
  const sibling = row({ signatureId: "acme.Store.get(string)" });

  assert.deepEqual(
    selectRustProviderOperation([sibling, group], identity({ signatureId: "acme.Store.get(number)" }), "method"),
    { kind: "selected", row: group },
  );
});

test("an export-level row never acts as a wildcard for a selected member", () => {
  const exportLevel = row({ memberId: undefined });

  assert.deepEqual(
    selectRustProviderOperation([exportLevel], identity(), "method"),
    { kind: "missing" },
  );
});

test("duplicate exact and group rows reject ambiguity deterministically", () => {
  const exactA = row({ signatureId: "acme.Store.get(number)", target: { form: "receiver-method", name: "get_a" } });
  const exactB = row({ signatureId: "acme.Store.get(number)", target: { form: "receiver-method", name: "get_b" } });
  const groupA = row({ target: { form: "receiver-method", name: "get_a" } });
  const groupB = row({ target: { form: "receiver-method", name: "get_b" } });

  const exact = selectRustProviderOperation([exactA, exactB], identity({ signatureId: exactA.signatureId }), "method");
  const group = selectRustProviderOperation([groupA, groupB], identity(), "method");
  assert.equal(exact.kind, "ambiguous");
  assert.deepEqual(exact.rows, [exactA, exactB]);
  assert.equal(group.kind, "ambiguous");
  assert.deepEqual(group.rows, [groupA, groupB]);
});

test("identical declaration ids from another provider owner never match", () => {
  const selected = row();
  const foreign = row({
    providerPackageId: "other-store",
    providerId: "tsonic.rust.provider-package.other-store.binding",
    providerModuleId: "other.store",
    moduleSpecifier: "@other/store",
  });

  assert.deepEqual(
    selectRustProviderOperation([foreign, selected], identity(), "method"),
    { kind: "selected", row: selected },
  );
  assert.deepEqual(
    selectRustProviderOperation([foreign], identity(), "method"),
    { kind: "missing" },
  );
});

test("provider selection requires the exact declaration provider version", () => {
  const selected = row();
  const stale = row({ providerVersion: "0.9.0" });

  assert.deepEqual(
    selectRustProviderOperation([stale, selected], identity(), "method"),
    { kind: "selected", row: selected },
  );
  assert.deepEqual(
    selectRustProviderOperation([stale], identity(), "method"),
    { kind: "missing" },
  );
});

test("public module aliases select the canonical provider operation owner", () => {
  const selected = row();

  assert.deepEqual(
    selectRustProviderOperation(
      [selected],
      identity({ moduleSpecifier: "store" }),
      "method",
    ),
    { kind: "selected", row: selected },
  );
  assert.deepEqual(
    selectRustProviderOperation(
      [selected],
      identity({ moduleSpecifier: "store", providerModuleId: "acme.other" }),
      "method",
    ),
    { kind: "missing" },
  );
});

test("selected provider evidence merges only compatible declaration granularity", () => {
  const exportIdentity = identity({ memberId: undefined, memberName: undefined, signatureId: undefined });
  const signatureIdentity = identity({ signatureId: "acme.Store.get(string)" });
  assert.deepEqual(
    mergeProviderDeclarationIdentities(exportIdentity, signatureIdentity),
    signatureIdentity,
  );
  assert.equal(
    mergeProviderDeclarationIdentities(signatureIdentity, identity({ memberId: "acme.Store.other", memberName: "other" })),
    undefined,
  );
  assert.equal(
    mergeProviderDeclarationIdentities(signatureIdentity, identity({ providerId: "tsonic.rust.provider-package.other.binding" })),
    undefined,
  );
  assert.equal(
    mergeProviderDeclarationIdentities(
      identity({ exportName: undefined, memberId: undefined, memberName: undefined, signatureId: undefined }),
      identity({ exportId: undefined, memberId: undefined, memberName: undefined, signatureId: undefined }),
    ),
    undefined,
  );
  assert.equal(
    mergeProviderDeclarationIdentities(
      identity({ memberId: undefined, signatureId: undefined }),
      identity({ memberId: undefined, signatureId: undefined }),
    ),
    undefined,
  );
});

test("provider resolution requires the exact selected subject and uses broader facts only as corroboration", () => {
  const selected = {};
  const callee = {};
  const selectedIdentity = identity({ signatureId: "acme.Store.get(string)" });
  const facts = new Map([[callee, selectedIdentity]]);
  const context = {
    source: { sourceFacts: {
      getFact(subject) {
        return facts.get(subject);
      },
    } },
  };

  const exactCallee = [{ subject: callee, precision: "exact" }];
  assert.deepEqual(resolveSelectedProviderDeclaration(context, selected, exactCallee), { kind: "missing" });
  facts.set(selected, selectedIdentity);
  assert.deepEqual(resolveSelectedProviderDeclaration(context, selected, exactCallee), {
    kind: "selected",
    identity: selectedIdentity,
  });
  facts.set(callee, identity({ memberId: "acme.Store.other", memberName: "other" }));
  assert.equal(resolveSelectedProviderDeclaration(context, selected, exactCallee).kind, "conflict");
});

test("declaration corroboration cannot override the checker-selected overload", () => {
  const selected = {};
  const callee = {};
  const selectedIdentity = identity({ signatureId: "acme.Store.get(string)" });
  const facts = new Map([
    [selected, selectedIdentity],
    [callee, identity({ signatureId: "acme.Store.get(number)" })],
  ]);
  const context = {
    source: { sourceFacts: {
      getFact(subject) {
        return facts.get(subject);
      },
    } },
  };

  assert.deepEqual(resolveSelectedProviderDeclaration(context, selected, [{
    subject: callee,
    precision: "declaration",
  }]), {
    kind: "selected",
    identity: selectedIdentity,
  });

  facts.set(callee, identity({ exportId: "acme.Other", exportName: "Other", signatureId: "acme.Other.get(number)" }));
  assert.equal(resolveSelectedProviderDeclaration(context, selected, [{
    subject: callee,
    precision: "declaration",
  }]).kind, "conflict");
});

test("provider lifetime inference preserves an exact argument lifetime before applying call elision", () => {
  const lifetimeIdentity = "parameter\0provider::lifetime::a";
  const parameterLifetime = {
    kind: "parameter",
    identity: "provider::lifetime::a",
    name: "a",
  };
  const innerLifetime = rustCallScopedElisionLifetime(
    "source.ts:20:30",
    lifetimeIdentity,
  );
  const outerElision = rustCallScopedElisionLifetime(
    "source.ts:10:40",
    lifetimeIdentity,
  );
  const int32 = { kind: "source-primitive", name: "int32" };
  const pattern = {
    kind: "reference",
    referent: int32,
    mutable: false,
    lifetime: parameterLifetime,
  };
  const actual = {
    ...pattern,
    lifetime: innerLifetime,
  };
  const instantiated = instantiateProviderOperationTemplate({
    kind: "provider-operation",
    operationId: "acme.borrow",
    operationKind: "method",
    target: { form: "call", path: "acme::borrow" },
    resultCarrier: pattern,
    parameterCarriers: [pattern],
    genericParameters: [{
      kind: "lifetime",
      sourceName: "A",
      targetIdentity: lifetimeIdentity,
    }],
    isAsync: false,
    isFallible: false,
    errorBoundary: "target-runtime",
  }, {
    sourceParameterCarriers: [actual],
    callScopedElisionBindings: new Map([[lifetimeIdentity, outerElision]]),
  });

  assert.ok(instantiated);
  assert.deepEqual(instantiated.substitutions.lifetimes.get(lifetimeIdentity), innerLifetime);
  assert.deepEqual(instantiated.template.resultCarrier, actual);
});

test("provider output-only lifetimes use call elision when source result semantics erase them", () => {
  const lifetimeIdentity = "parameter\0provider::lifetime::a";
  const parameterLifetime = {
    kind: "parameter",
    identity: "provider::lifetime::a",
    name: "a",
  };
  const callElision = rustCallScopedElisionLifetime(
    "source.ts:10:20",
    lifetimeIdentity,
  );
  const resultCarrier = {
    kind: "impl-trait",
    id: "acme.opaque",
    bounds: [],
    outlives: [],
    captures: [{ kind: "lifetime", lifetime: parameterLifetime }],
  };
  const instantiated = instantiateProviderOperationTemplate({
    kind: "provider-operation",
    operationId: "acme.opaque",
    operationKind: "method",
    target: { form: "call", path: "acme::opaque" },
    resultCarrier,
    genericParameters: [{
      kind: "lifetime",
      sourceName: "A",
      targetIdentity: lifetimeIdentity,
    }],
    isAsync: false,
    isFallible: false,
    errorBoundary: "target-runtime",
  }, {
    sourceResultCarrier: { kind: "source-primitive", name: "int32" },
    callScopedElisionBindings: new Map([[lifetimeIdentity, callElision]]),
  });

  assert.ok(instantiated);
  assert.deepEqual(instantiated.substitutions.lifetimes.get(lifetimeIdentity), callElision);
  assert.deepEqual(instantiated.template.resultCarrier, {
    ...resultCarrier,
    captures: [{ kind: "lifetime", lifetime: callElision }],
  });
});
