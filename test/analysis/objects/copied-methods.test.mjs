import assert from "node:assert/strict";
import test from "node:test";
import { proveRustCopiedMethodFlow, selectRustCopiedMethods } from "../../../dist/analysis/objects/copied-methods.js";
import { rustCallableTargetType, rustSourcePrimitiveTargetType,
  rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { structuralStorageKey } from "../../../dist/policy/types/objects/structural-storage.js";

const sources = entries => new Map(entries.map(([identity, values]) => [identity, new Set(values)]));

test("grounded copied methods remain receiver-independent through self and rest/spread cycles", () => {
  const incoming = sources([["original", ["rest"]], ["copy", ["original", "copy"]], ["rest", ["copy"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["original", "copy", "rest"], incoming, new Map([["original", true]])),
    new Set(["original", "copy", "rest"]));
});

test("a copied method cycle cannot manufacture an implementation", () => {
  const incoming = sources([["first", ["second"]], ["second", ["first"]], ["self", ["self"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["first", "second", "self"], incoming, new Map()), new Set());
});

test("every receiver-dependent implementation poisons its transitive copied destinations", () => {
  const incoming = sources([["first", ["second"]], ["second", ["first"]], ["third", ["second"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["first", "second", "third", "independent"], incoming,
    new Map([["first", true], ["second", false], ["independent", true]])), new Set(["independent"]));
});

test("an ungrounded or absent source is not hidden by another independent implementation", () => {
  const incoming = sources([["first", ["unknown"]], ["unknown", ["unknown"]], ["second", ["missing"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["first", "unknown", "second"], incoming,
    new Map([["first", true], ["second", true]])), new Set());
});

test("proof is independent of visitation order and rejects a mixed-source join", () => {
  const identities = ["safe", "unsafe", "join", "last"];
  const incoming = sources([["join", ["safe", "unsafe"]], ["last", ["join"]]]);
  const implementations = new Map([["safe", true], ["unsafe", false]]);
  for (const order of [identities, [...identities].reverse()]) {
    assert.deepEqual(proveRustCopiedMethodFlow(order, incoming, implementations), new Set(["safe"]));
  }
});

for (const receiverDependent of [false, true]) {
  test(`an instantiated copied template preserves its complete original receiver proof (${receiverDependent ? "dependent" : "independent"})`, () => {
    const integer = rustSourcePrimitiveTargetType("int32");
    const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
    const methodCarrier = rustCallableTargetType([], integer);
    const shape = (value, prefix) => rustStructuralObjectTargetType("/source.ts", [
      ...(prefix ? [{ sourceName: "prefix", type: integer, presence: "required", readonly: false }] : []),
      { sourceName: "read", type: methodCarrier, method: true, presence: "required", readonly: false },
      { sourceName: "value", type: value, presence: "required", readonly: false },
    ]);
    const original = shape(parameter, false);
    const template = shape(parameter, true);
    const instance = shape(integer, true);
    const body = { kind: "KindBlock", children: receiverDependent ? [{ kind: "KindThisKeyword", children: [] }] : [] };
    const method = { kind: "KindMethodDeclaration", body, children: [body] };
    const originalNode = {};
    const copyNode = {};
    const readNode = {};
    const root = { children: [originalNode, copyNode, readNode] };
    const operations = new Map([
      [originalNode, { kind: "record-literal", storage: "structural-object", resultCarrier: original,
        fields: [{ storageIndex: 0, carrier: methodCarrier }],
        contributions: [{ kind: "structural-method", targetStorageIndex: 0, expression: method }] }],
      [copyNode, { kind: "record-literal", storage: "structural-object", resultCarrier: template, fields: [],
        contributions: [{ kind: "spread", sourceStorage: "structural-object", sourceValueCarrier: original,
          property: copyNode, expression: originalNode,
          fields: [{ method: true, sourceStorageIndex: 0, targetStorageIndex: 1 }] }] }],
      [readNode, { kind: "source-field", storage: "structural-object", receiverCarrier: instance,
        storageIndex: 1, valueSemantics: { kind: "method" } }],
    ]);
    const ast = {
      body: node => node.body,
      children: node => node.children ?? [],
      kindName: node => node.kind,
      kind: node => node === method || node === copyNode ? 1 : undefined,
      forEachChild: (node, visit) => { for (const child of node.children ?? []) visit(child); },
    };
    const bindings = {};
    const sourceFile = {};
    const subject = (node, kind = "value", projection = []) => ({ kind: "resolved", subject: { node, kind, projection } });
    const storage = {
      source: { ast, semantics: { forFile: () => ({ types: { nonNullableType: type => type } }) } },
      subject,
      subjectFor: node => subject(node),
      storageSubjectFor: (node, projection) => subject(node, "value", projection),
      typeFor: selected => ({ kind: "resolved", type: selected.node === originalNode ? original : instance, sourceFile }),
      bindingsForLexicalOwner: () => ({ kind: "resolved", bindings }),
      storageProducersFor: () => ({ kind: "complete", producers: [{ subject: { kind: "value", node: method, projection: [] },
        type: methodCarrier, sourceFile, bindings }] }),
    };
    const missing = { get: () => undefined };
    const selected = selectRustCopiedMethods({ context: { ast, sourceStorage: storage, isNativeNode: () => true,
      records: { targetOperation: { get: node => operations.get(node) }, bindingProjection: missing,
        selectedOperation: { get: node => node === readNode
          ? { provenance: { sourceReceiver: copyNode, sourceSelectedDeclaration: method } } : undefined },
        objectReferenceView: missing } },
      sourceTypes: { structuralObjectForCarrier: carrier => ({ fields: carrier === original
        ? [{ storageIndex: 0, method: true, declarations: [method] }]
        : [{ storageIndex: 0 }, { storageIndex: 1, method: true, declarations: [method] }] }) } }, [root], () => "app");
    for (const [carrier, index] of [[original, 0], [template, 1], [instance, 1]]) {
      const identity = `${structuralStorageKey(carrier, () => "app")}#${index}`;
      const decision = selected.decisions.get(identity);
      assert.equal(decision !== undefined, true, "each actual method-flow slot participates");
      assert.equal(decision.kind === "proven", !receiverDependent,
        "template instantiation retains the original body receiver dependence");
    }
  });
}
