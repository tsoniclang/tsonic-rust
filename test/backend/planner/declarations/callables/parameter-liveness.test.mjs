import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../../helpers/plan-context.mjs";
import { planRustCallableParameters } from "../../../../../dist/backend/planner/declarations/callables/parameters.js";
import { rustLintAttributes } from "../../../../../dist/backend/target-ast/normalization/lint-policy.js";
import { rustTypeEquals } from "../../../../../dist/backend/target-ast/syntax/type-equality.js";

test("native signatures and forwarders never inherit authored-body parameter liveness", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function unused(value: number): number { return 1; }
export function observed(value: number): number { return value; }
export function overwritten(value: number): number { value = 7; return value; }
` } });
  const ast = program.source.ast;
  const declarations = [];
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) declarations.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(declarations.length, 3, "all actual checked source bodies remain");
  for (const declaration of declarations) {
    const name = ast.text(ast.name(declaration));
    const parameter = ast.parameters(declaration)[0];
    const selected = program.records.callableDeclaration.get(declaration);
    const liveness = program.records.bindingLiveness.get(parameter);
    assert.equal(selected?.contract.kind, "source", `${name}: use the real admitted callable contract`);
    assert.equal(liveness !== undefined, true, `${name}: analysis owns the complete body liveness`);
    const context = rustSourceFilePlanContext(program, declaration);
    const body = planRustCallableParameters(selected.contract, context, context.syntheticNames, "source-body");
    const signatureContext = rustSourceFilePlanContext(program, declaration);
    const signature = planRustCallableParameters(selected.contract, signatureContext, signatureContext.syntheticNames, "signature");
    assert.equal(body.params.length, 1, `${name}: preserve the real formal parameter`);
    assert.equal(signature.params.length, 1, `${name}: signatures retain the same ABI arity`);
    assert.equal(body.params[0].name, signature.params[0].name, `${name}: native identifiers are unchanged`);
    assert.equal(rustTypeEquals(body.params[0].type, signature.params[0].type), true,
      `${name}: native signature and source body have identical physical types`);
    assert.equal(body.params[0].attrs?.includes(rustLintAttributes.unusedVariables) === true, liveness.unused,
      `${name}: an actual authored body still consumes its sealed unused-variable disposition`);
    assert.equal(body.params[0].attrs?.includes(rustLintAttributes.unusedAssignments) === true,
      body.params[0].mutable && liveness.unusedInitializer,
      `${name}: an actual authored body retains the native overwritten-initializer disposition`);
    assert.equal(signature.params[0].attrs?.length ?? 0, 0,
      `${name}: a signature or forwarding parameter has no source-body warning expectation`);
    assert.equal(signature.params[0].mutable, false, `${name}: a native signature has no source-body mut pattern`);
    assert.equal(body.params[0].mutable, name === "overwritten", `${name}: actual source writes keep native body mutability`);
  }
});
