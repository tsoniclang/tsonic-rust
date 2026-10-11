import assert from "node:assert/strict";
import test from "node:test";
import { rustOperationContext, rustResolutionContext } from "../../../dist/analysis/program/walk.js";

function fixture() {
  const node = {};
  const semantics = { sourceFile: {} };
  const selected = [];
  const subject = Object.freeze({ kind: "value", node, projection: [] });
  const context = {
    facts: {},
    ast: { is: { IsTypeAliasDeclaration: () => false, IsInterfaceDeclaration: () => false,
      IsTypeParameterDeclaration: () => false } },
    sourceStorage: {
      storageSubjectFor(owner) { assert.equal(owner === node, true); selected.push("inferred"); return { kind: "resolved", subject }; },
      subject(owner, kind) { assert.equal(owner === node, true); selected.push(kind); return { kind: "resolved", subject: { ...subject, kind } }; },
    },
    semanticsFor(owner) { assert.equal(owner === node, true); return semantics; },
  };
  return { node, semantics, selected, subject, walk: { context } };
}

test("operation contexts carry checked scope without leaking their result's physical storage into operands", () => {
  const input = fixture();
  const context = rustOperationContext(input.walk, input.node);
  assert.equal(context.currentSemantics === input.semantics && context.currentSourceFile === input.semantics.sourceFile, true);
  assert.equal(context.facts === input.walk.context.facts, true);
  assert.equal(context.extensionId, "tsonic.rust.policy");
  assert.equal(Object.hasOwn(context, "sourceStorageSubject"), false, "each selected operand owns its physical storage");
  assert.deepEqual(input.selected, [], "scope selection must not launch a result storage query");
});

test("storage resolution still retains its exact inferred or explicitly selected role", () => {
  for (const kind of [undefined, "value", "input", "return", "member", "receiver"]) {
    const input = fixture();
    const context = rustResolutionContext(input.walk, input.node, kind);
    assert.equal(context.currentSemantics === input.semantics && context.currentSourceFile === input.semantics.sourceFile, true);
    assert.equal(context.sourceStorageSubject.node === input.node, true);
    assert.equal(context.sourceStorageSubject.kind, kind ?? "value");
    assert.deepEqual(input.selected, [kind ?? "inferred"]);
  }
});
