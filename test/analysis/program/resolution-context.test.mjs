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
  ` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the original body and members are checked");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/src/index.ts");
  const nodes = new Map();
  const visit = node => {
    const name = source.ast.name(node);
    if (name !== undefined && source.ast.is.IsIdentifier(name)) nodes.set(source.ast.text(name), node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  const storage = createSourceStorageQuery(source, [file]);
  const selected = [];
  const currentCallableDeclaration = nodes.get("run");
  const scope = storage.bindingsForDeclaration(currentCallableDeclaration);
  assert.equal(scope.kind, "resolved", "the original callable owns the actual checked binding");
  const context = {
    records: {}, ast: source.ast,
    sourceStorage: { ...storage,
      storageSubjectFor(node) { selected.push("inferred"); return storage.storageSubjectFor(node); },
      subject(node, kind, projection) { selected.push(kind); return storage.subject(node, kind, projection); },
    },
    semanticsFor: source.semantics.forNode,
  };
  return { nodes, selected, scope, source, file, walk: { context, currentCallableDeclaration } };
}

test("operation contexts carry checked scope without leaking their result's physical storage into operands", () => {
  const input = fixture();
  const context = rustOperationContext(input.walk, input.nodes.get("selected"));
  assert.equal(context.currentSemantics === input.source.semantics.forFile(input.file) && context.currentSourceFile === input.file, true);
  assert.equal(context.records === input.walk.context.records, true);
  assert.equal(context.extensionId, "tsonic.rust.policy");
  assert.equal(context.sourceStorageResolution.kind, "resolved", "the exact original scope is retained");
  assert.equal(context.sourceStorageResolution.bindings === input.scope.bindings, true);
  assert.equal(context.sourceStorageResolution.subject, undefined, "each selected operand owns its physical storage");
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
