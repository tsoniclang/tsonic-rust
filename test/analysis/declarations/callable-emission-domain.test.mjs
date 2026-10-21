import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

function nodes(program) {
  const result = [];
  const visit = node => { result.push(node); program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
  return result;
}

test("runtime callable result admission excludes type-only callback signatures", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function invoke(callback: () => string): string { return callback(); }
` } });
  const ast = program.source.ast;
  const all = nodes(program);
  const declaration = all.find(ast.is.IsFunctionDeclaration);
  const signature = all.find(ast.is.IsFunctionTypeNode);
  assert.equal(signature !== undefined, true, "the source callback retains its exact checked function type");
  assert.equal(program.records.callableReturn.get(declaration) !== undefined, true, "the runtime producer has a physical return selection");
  assert.equal(program.records.callableReturn.get(signature), undefined, "a type signature is not a runtime storage producer");
  const parameters = all.filter(ast.is.IsParameterDeclaration).flatMap(node => {
    const selected = program.records.callableParameter.get(node);
    return selected === undefined ? [] : [selected];
  });
  assert.equal(parameters.length > 0, true, "the runtime declaration retains its native physical parameter");
  for (const parameter of parameters) assert.equal(program.records.typeEmission.get(parameter.carrier)?.positions.parameter, true,
    "the exact physical parameter carrier is closed before planning");
});

test("native accessor emission consumes the exact read and write slots selected by the name owner", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export class Counter {
  value: number = 1;
  get current(): number { return this.value; }
  set current(value: number) { this.value = value; }
}
` } });
  const ast = program.source.ast;
  const declaration = nodes(program).find(ast.is.IsClassDeclaration);
  const selected = program.records.nativeClass.get(declaration);
  assert.equal(selected.accessors.length, 2, "both exact source accessor declarations are retained");
  for (const accessor of selected.accessors) {
    const emission = program.records.methodDeclaration.get(accessor.declaration);
    assert.equal(emission !== undefined, true, accessor.role + ": one native emission owner");
    assert.equal(emission.name, accessor.name, accessor.role + ": the renderer reads the already selected native slot");
  }
});
