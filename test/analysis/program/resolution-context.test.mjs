import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { rustOperationContext, rustResolutionContext } from "../../../dist/analysis/program/walk.js";

function fixture() {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { "/src/index.ts": `
    class Box {
      value = 1;
      run(argument: number): number { const selected = argument; return selected; }
    }
    function enclosing<Value>(value: Value): Value {
      function nested(): Value { return value; }
      const callback = (): Value => value;
      void callback;
      return nested();
    }
    function unrelated<Other>(other: Other): Other { return other; }
  ` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the original body and members are checked");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/src/index.ts");
  const nodes = new Map();
  const arrows = [];
  const visit = node => {
    if (source.ast.is.IsArrowFunction(node)) arrows.push(node);
    const name = source.ast.name(node);
    if (name !== undefined && source.ast.is.IsIdentifier(name)) nodes.set(source.ast.text(name), node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  const storage = createSourceStorageQuery(source, [file]);
  const selected = [];
  const currentCallableDeclaration = nodes.get("run");
  const scope = storage.bindingsForLexicalOwner(currentCallableDeclaration);
  assert.equal(scope.kind, "resolved", "the original callable owns the actual checked binding");
  const context = {
    records: {}, ast: source.ast,
    sourceStorage: { ...storage,
      storageSubjectFor(node) { selected.push("inferred"); return storage.storageSubjectFor(node); },
      subject(node, kind, projection) { selected.push(kind); return storage.subject(node, kind, projection); },
    },
    semanticsFor: source.semantics.forNode,
  };
  return { nodes, arrows, storage, selected, scope, source, file, walk: { context, currentCallableDeclaration } };
}

test("operation contexts carry checked scope without leaking their result's physical storage into operands", () => {
  const input = fixture();
  const context = rustOperationContext(input.walk, input.nodes.get("selected"));
  assert.equal(context.currentSemantics === input.source.semantics.forFile(input.file) && context.currentSourceFile === input.file, true);
  assert.equal(context.records === input.walk.context.records, true);
  assert.equal(context.extensionId, "tsonic.rust.policy");
  assert.equal(context.sourceStorageResolution.kind, "resolved", "the exact original scope is retained");
  assert.equal(context.sourceStorageResolution.bindings === input.scope.bindings, true);
  assert.equal(context.sourceStorageResolution.subject === undefined, true, "each selected operand owns its physical storage");
  assert.equal(Object.hasOwn(context, "sourceStorageSubject"), false, "the removed unbound API is not published");
  assert.deepEqual(input.selected, [], "scope selection must not launch a result storage query");
});

test("storage resolution still retains its exact inferred or explicitly selected role", () => {
  for (const [kind, name] of [[undefined, "selected"], ["value", "selected"], ["input", "argument"],
    ["return", "run"], ["member", "value"], ["receiver", "Box"]]) {
    const input = fixture();
    const node = input.nodes.get(name);
    const context = rustResolutionContext(input.walk, node, kind);
    assert.equal(context.currentSemantics === input.source.semantics.forFile(input.file) && context.currentSourceFile === input.file, true);
    assert.equal(context.sourceStorageResolution.kind, "resolved", "the actual source subject and binding are selected together");
    assert.equal(context.sourceStorageResolution.subject.node === node, true);
    assert.equal(context.sourceStorageResolution.subject.kind, kind ?? "value");
    assert.equal(context.sourceStorageResolution.bindings === input.scope.bindings, true);
    assert.deepEqual(input.selected, [kind ?? "inferred"]);
  }
});

test("body scopes retain enclosing generic activations without admitting unrelated owners", () => {
  const input = fixture();
  for (const declaration of [input.nodes.get("nested"), ...input.arrows]) {
    const context = rustOperationContext({ ...input.walk, currentCallableDeclaration: declaration },
      input.nodes.get("unrelated"));
    const resolution = context.sourceStorageResolution;
    assert.equal(resolution.kind, "resolved", "the explicit body owner selects its checked lexical scope");
    const expected = input.storage.bindingsForLexicalOwner(declaration);
    assert.equal(expected.kind, "resolved");
    assert.equal(resolution.bindings === expected.bindings, true, "one canonical lexical binding identity");
    for (const owner of [declaration, input.nodes.get("enclosing")]) {
      const activation = input.storage.boundActivationsFor(owner, resolution.bindings);
      assert.equal(activation.kind, "resolved", "both the nested body and its generic owner remain bound");
      assert.equal(activation.activations.length, 1);
      assert.equal(activation.activations[0].kind, "declaration");
    }
    assert.equal(input.storage.boundActivationsFor(input.nodes.get("unrelated"), resolution.bindings).kind,
      "unresolved", "an unrelated operand cannot supply the active body's generic bindings");
    assert.equal(resolution.subject === undefined, true, "lexical scope does not select physical result storage");
  }
  assert.deepEqual(input.selected, [], "lexical scope does not perform an operand storage query");
});
