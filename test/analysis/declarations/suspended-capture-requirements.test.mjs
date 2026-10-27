import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`shared suspended captures publish their exact native storage requirement on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
function consume<Value>(value: Value) { return async () => value; }
export function ordinary(value: number): void { void consume(value); }
export function identity<Value>(value: Value): Value { return value; }
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(issue => issue.code + ": " + issue.message).join("\n").slice(0, 2048));
    const program = result.program;
    assert.equal(program !== undefined && result.artifacts.length > 0, true,
      "the actual ordinary generic program is planned and emitted");
    const { ast } = program.source;
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const file of program.sourceFiles) {
      if (ast.getFileName(file).endsWith("/index.ts")) visit(file);
    }
    const arrow = nodes.find(node => ast.is.IsArrowFunction(node));
    assert.equal(arrow !== undefined, true, "the original returned arrow is present");
    const captures = program.records.closureCapture.get(arrow);
    assert.equal(captures?.invocationOwner, "shared-state",
      "the actual native suspended-state owner determines capture storage");
    assert.equal(captures.captures.length, 1, "only the original Value parameter is captured");
    const capture = captures.captures[0];
    const ownership = program.records.captureOwnership.get(arrow)?.find(row => row.declaration === capture.declaration);
    assert.equal(ownership !== undefined, true, "the original capture has its selected ownership");
    const required = ownership.read.kind === "clone" ? ["clone", "static"] : ["static"];
    for (const body of [undefined, true]) {
      const contract = program.declarationGenericRequirements.contractFor(arrow, body);
      assert.equal(contract !== undefined, true, "the original source/body requirement contract is published");
      assert.equal(contract.uses.some(use => use.node === capture.reference && use.carrier === capture.carrier &&
        use.requirements.length === required.length && use.requirements.every((value, index) => value === required[index])), true,
      "the exact original capture tuple is decided before publication");
      assert.equal(program.records.genericRequirementUse.get(arrow, capture.reference, capture.carrier, required, body), true,
        "the required native construction reads the same sealed tuple");
      assert.equal(contract.capturedTypeParameters.some(parameter => parameter.identity === capture.carrier.identity &&
        parameter.requirements.includes("static")), true,
      "the exact captured generic identity carries its native state requirement");
    }
    const identity = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "identity");
    assert.equal(identity !== undefined, true, "the separate direct generic owner remains present");
    const direct = program.declarationGenericRequirements.contractFor(identity);
    assert.equal(direct !== undefined && direct.typeParameters.length === 1, true,
      "the ordinary generic identity retains its authored parameter");
    assert.equal(direct.typeParameters[0].requirements.includes("static"), false,
      "shared-state storage does not impose a blanket bound on unrelated native generics");
  });
}
