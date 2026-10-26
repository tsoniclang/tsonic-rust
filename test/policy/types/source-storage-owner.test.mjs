import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { selectedValueCarrier } from "../../../dist/analysis/operations/selected-values.js";
import { rustCallableTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";

for (const expression of ["callback", "holder.callback", "callbacks[0]", '(() => "text")']) {
  test(`selected callable ${expression} uses its value owner, not its enclosing call result`, () => {
    const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { "/src/index.ts": `
      const callback: () => string = () => "text";
      const holder = { callback };
      const callbacks: [() => string] = [callback];
      const text = ${expression}();
    ` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
    assert.equal(checked.diagnostics.length, 0, "the original source is checked without annotations added for storage");
    const source = createTargetSourceProgram(checked);
    const file = checked.getSourceFile("/src/index.ts");
    const calls = [];
    const visit = node => {
      if (source.ast.is.IsCallExpression(node)) calls.push(node);
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
    assert.equal(calls.length, 1);
    const call = source.semantics.forNode(calls[0]).operations.call(calls[0]);
    const operand = call.sourceCallee.expression;
    const storage = createSourceStorageQuery(source, [file]);
    const enclosing = storage.subjectFor(calls[0]);
    const expected = storage.subjectFor(operand);
    assert.equal(enclosing.kind, "resolved");
    assert.equal(expected.kind, "resolved");
    assert.equal(expected.subject === enclosing.subject, false, "callee and result are different physical values");
    const carrier = rustCallableTargetType([], rustStringTargetType());
    const context = {
      ast: source.ast, source, sourceStorage: storage, sourceStorageSubject: enclosing.subject,
      currentSourceFile: file, currentSemantics: source.semantics.forFile(file),
      semantics: selected => source.semantics.forFile(selected),
      semanticsFor: node => source.semantics.forNode(node),
      callableRepresentation: "storage", typeDefinitions: emptyRustTypeDefinitions,
      sourceLifetimes: { contractFor: () => undefined }, pointerReturns: { resolve: () => undefined },
      requiredRecords: [],
      records: createRustProgramRecordBuilder(emptyRustTypeDefinitions, createRustRecordFixture({
        runtimeCarrier: { get: (node) => node === operand ? { carrier } : undefined },
      })),
    };
    let selections = 0;
    const options = {
      projectTypes: {}, jsEnabled: false, providerTypes: [],
      sourceProfiles: { profileForNode: () => undefined },
      sourceTypes: { structuralObjectForType: () => undefined, carrierForDeclaration: () => undefined },
      callableStorageCarrier(subject) {
        selections += 1;
        assert.equal(subject === expected.subject, true, "checked type and stored operand share the exact value owner");
        return carrier;
      },
    };
    assert.equal(selectedValueCarrier(operand, call.sourceCallee.type, context, options) === carrier, true);
    assert.equal(selections, 1, "a stored carrier does not excuse misattributing the checked type");
    assert.equal(context.sourceStorageSubject === enclosing.subject, true, "the enclosing operation is immutable");
  });
}
