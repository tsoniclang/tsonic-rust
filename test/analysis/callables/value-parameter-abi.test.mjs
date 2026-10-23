import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  const label = surfaces[0] ?? "native";
  for (const [name, text, expected] of [
    ["ordinary declaration", "export function source(this: void, value: number): number { return value; } console.log(source(7));", 1],
    ["defaulted contextual inputs", "const source: (value?: number, label?: string) => number = function(this: void, value = 1, label = 'x') { return value + label.length; }; console.log(source());", 2],
    ["ordinary first value", "export function source(thisValue: number, label: string): number { return thisValue + label.length; } console.log(source(7, 'x'));", 2],
  ]) {
    test(`${label} ${name} publishes only checked native value parameters`, () => {
      const { source, program } = analyzeRust({ surfaces, files: { "index.ts": text } });
      assert.equal(program !== undefined, true, "the actual checked program is admitted");
      const { ast } = program.source;
      let declaration;
      const visit = node => {
        if ((ast.is.IsFunctionDeclaration(node) || ast.is.IsFunctionExpression(node)) && ast.body(node) !== undefined) declaration = node;
        ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      program.sourceFiles.forEach(visit);
      assert.equal(declaration !== undefined, true, "the original callable exists");
      const checked = createTargetSourceProgram(source).semantics.forNode(declaration).types.declarationSignatureInfo(declaration);
      const pseudo = checked.thisParameter?.declaration;
      const emission = program.records.callableDeclaration.get(declaration);
      assert.equal(emission.contract.parameters.length, expected, "the native value vector has no phantom receiver slot");
      assert.equal(emission.contract.parameters.every(parameter => parameter !== pseudo), true, "the checked pseudo identity is absent");
      assert.equal(emission.contract.parameters.every(parameter => program.records.sourceParameterAbi.get(parameter) !== undefined), true, "every actual value input retains its ABI");
      assert.equal(pseudo === undefined || program.records.sourceParameterAbi.get(pseudo) === undefined, true, "the pseudo parameter has no runtime ABI");
      assert.equal(Object.isFrozen(emission.contract.parameters), true, "the required vector is sealed");
    });
  }
}
