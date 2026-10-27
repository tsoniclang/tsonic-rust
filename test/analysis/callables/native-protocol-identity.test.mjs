import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustNativeCallableErrorType } from "../../../dist/policy/types/callables/native-protocols.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { compileRust } from "../../helpers/rust-session.mjs";

test("cross-file protocol definitions normalize types while each input retains its own environment and identity", () => {
  const { program } = analyzeRust({ surfaces: [], files: {
    "left.ts": `export function left<Value>(callback: (value: Value) => Value): (value: Value) => Value { return callback; }`,
    "right.ts": `export function right<Item>(callback: (value: Item) => Item): (value: Item) => Item { return callback; }`,
    "different.ts": `export function different(callback: (value: number) => string): (value: number) => string { return callback; }`,
    "index.ts": `export { left } from "./left.js"; export { right } from "./right.js"; export { different } from "./different.js";`,
  } });
  const native = program.callableValues.native;
  const ast = program.source.ast;
  const input = name => native.inputs.find(input => ast.text(ast.name(input.owner)) === name);
  const left = input("left");
  const right = input("right");
  const different = input("different");
  assert.equal(left !== undefined && right !== undefined && different !== undefined, true);
  assert.equal(left.protocol === right.protocol, true);
  assert.equal(left.protocol === different.protocol, false);
  assert.equal(native.protocols.length, 2);
  assert.equal(left.implementation.identity === right.implementation.identity, false);
  assert.equal(left.environment.length, 1);
  assert.equal(right.environment.length, 1);
  assert.equal(left.environment[0].kind === "type" && right.environment[0].kind === "type", true,
    "both actual native environments retain their required type argument kind");
  assert.equal(rustTargetTypeRefEquals(left.environment[0].type, right.environment[0].type), false);
  assert.equal(rustTargetTypeRefEquals(left.trait, right.trait), false);
  for (const selected of [left, right]) {
    const error = rustNativeCallableErrorType(selected, selected.implementation, "invocation", []);
    assert.equal(error.owner === selected.implementation, true);
    assert.equal(selected.environment[0].kind === "type" &&
      rustTargetTypeRefEquals(error.trait.genericArguments[0].type, selected.environment[0].type), true);
  }
  assert.equal(native.protocolForSourceItem(left.protocol.ownerFileName, left.protocol.targetName) === left.protocol, true);
  assert.equal(native.protocolForSourceItem("/foreign.ts", left.protocol.targetName) === undefined, true);
});

test("same-signature callback inputs share protocol shape but retain independent invocation error owners", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    export function pair(left: () => number, right: () => number): number { return left() + right(); }
  ` } });
  const { inputs, calls, protocols } = program.callableValues.native;
  assert.equal(inputs.length, 2);
  assert.equal(protocols.length, 1);
  assert.equal(inputs[0].subject === inputs[1].subject, false);
  assert.equal(inputs[0].implementation.identity === inputs[1].implementation.identity, false);
  assert.equal(calls.length, 2);
  assert.equal(rustTargetTypeRefEquals(calls[0].invocationError, calls[1].invocationError), false);
  assert.equal(calls[0].invocationErrorSource === calls[1].invocationErrorSource, false);
  assert.equal(calls[0].invocationError.trait.id, calls[1].invocationError.trait.id);
});

test("canonical protocols use an emitted source module and never an earlier declaration contract", () => {
  const files = {
    "aaa-contract.d.ts": "export type Contract = number;",
    "a-helper.ts": "export type Helper = number;",
    "index.ts": `
      import type { Contract } from "./aaa-contract.js";
      import type { Helper } from "./a-helper.js";
      export function apply(left: () => Contract, right: () => Helper): number { return left() + right(); }
    `,
  };
  const { program } = analyzeRust({ surfaces: [], files });
  const { protocols } = program.callableValues.native;
  const ast = program.source.ast;
  assert.equal(protocols.length, 1);
  assert.equal(protocols[0].ownerFileName, "/src/a-helper.ts");
  assert.equal(program.sourceFiles.some(file => ast.isDeclarationFile(file)), false);
  assert.equal(program.sourceFiles.some(file => ast.getFileName(file) === protocols[0].ownerFileName), true);
  const { result } = compileRust({ surfaces: [], files });
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
  const declarations = result.artifacts.filter(artifact => artifact.text.includes(`pub trait ${protocols[0].targetName}`));
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].path, "src/a_helper.rs");
  assert.equal(result.artifacts.some(artifact => artifact.path.includes("aaa_contract")), false);
});
