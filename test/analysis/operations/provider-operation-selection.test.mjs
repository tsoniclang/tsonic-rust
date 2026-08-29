import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRustProviderOperation } from "../../../dist/policy/operations/provider-selection.js";
import { instantiateProviderOperationTemplate } from "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import {
  mergeProviderDeclarationIdentities,
  resolveSelectedProviderDeclaration,
} from "../../../dist/policy/evidence/selected-source.js";
import { rustCallScopedElisionLifetime } from "../../../dist/target-model/lifetimes/index.js";

const unit = { kind: "tuple", elements: [] };

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
    facts: {
      get(subject) {
        return facts.get(subject);
      },
    },
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
    facts: {
      get(subject) {
        return facts.get(subject);
      },
    },
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
