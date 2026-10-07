import assert from "node:assert/strict";
import test from "node:test";
import { sourcePrimitiveFactKey } from "@tsonic/tsts";
import { resolveRustCallableEvidence } from "../../../dist/policy/types/resolution/source-evidence.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { resolveRustConstructSignature } from "../../../dist/policy/types/resolution/constructors.js";

function fixture(purpose) {
  const resultType = Object.freeze({});
  const symbol = Object.freeze({});
  const subject = Object.freeze({ kind: "value", node: Object.freeze({}), projection: [] });
  let storageQueries = 0;
  const semantics = {
    declarations: { typeSymbol: () => symbol, typeAliasSymbol: () => undefined, symbolDeclarations: () => [] },
    types: { isTypeReference: () => false, isNonPrimitive: () => false },
    facts: { typeSubjects: () => [] },
  };
  const context = {
    callableRepresentation: purpose,
    sourceStorageSubject: subject,
    currentSemantics: semantics,
    ast: { kind: () => undefined, as: { AsParameterDeclaration: () => undefined } },
    source: { sourceFacts: { getFact: () => undefined } },
    sourceLifetimes: { contractFor: () => undefined },
    facts: { get: (selected, key) => selected === symbol && key === sourcePrimitiveFactKey ? { kind: "float64" } : undefined },
  };
  const options = {
    jsEnabled: true,
    sourceTypes: { structuralObjectForType: () => undefined },
    callableStorageCarrier(selected, logical) {
      storageQueries++;
      assert.equal(selected === subject, true);
      assert.equal(rustCallableProtocol(logical)?.result.name, "float64");
      throw new Error("physical ownership remains unsealed");
    },
  };
  return { context, options, callable: { parameters: [], result: { selectedType: resultType } }, queries: () => storageQueries };
}

test("signature purpose never queries physical activation storage", () => {
  const selected = fixture("signature");
  const carrier = resolveRustCallableEvidence(selected.callable, selected.context, selected.options, new Set());
  assert.equal(rustCallableProtocol(carrier)?.parameters.length, 0);
  assert.equal(rustCallableProtocol(carrier)?.result.name, "float64");
  assert.equal(selected.queries(), 0);
});

test("storage purpose retains the physical ownership guard", () => {
  const selected = fixture("storage");
  assert.throws(() => resolveRustCallableEvidence(selected.callable, selected.context, selected.options, new Set()),
    /physical ownership remains unsealed/u);
  assert.equal(selected.queries(), 1);
});

test("constructor contracts remain logical even when their enclosing value has physical storage", () => {
  const selected = fixture("storage");
  const declaration = {};
  const signature = {};
  selected.context.ast.typeParameters = () => [];
  selected.context.ast.typeNode = () => undefined;
  selected.context.sourceStorage = { subject: () => ({ kind: "unresolved", reason: "A signature is not a value." }) };
  selected.context.pointerReturns = { resolve: () => undefined };
  selected.context.semanticsFor = () => selected.context.currentSemantics;
  selected.context.currentSemantics.declarations.signatureDeclaration = candidate => candidate === signature ? declaration : undefined;
  const signatureInfo = { signature, parameters: [], returnType: selected.callable.result.selectedType };
  const construction = resolveRustConstructSignature(signatureInfo, selected.context, selected.options, new Set());
  assert.equal(construction !== undefined, true);
  assert.equal(construction.declaration === declaration, true);
  assert.equal(construction.signatureInfo === signatureInfo, true);
  assert.equal(selected.queries(), 0, "logical construction cannot request unsealed physical ownership");
});
