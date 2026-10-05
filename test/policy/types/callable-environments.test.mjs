import assert from "node:assert/strict";
import test from "node:test";
import { bindRustCallableEnvironment, resolveRustCallableEnvironment } from "../../../dist/policy/types/resolution/callable-environments.js";
import { rustSourceTypeParameter } from "../../../dist/target-model/names/type-parameters.js";
import { rustGenericCallableProtocol, rustGenericCallableTargetType, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";

function input() {
  const file = { path: "/callable.ts" };
  const declarations = [10, 20].map(position => ({ file, position, name: { text: "Same" }, kind: "type-parameter" }));
  const ast = {
    is: { IsTypeParameterDeclaration: declaration => declaration.kind === "type-parameter" },
    name: declaration => declaration.name,
    text: name => name.text,
    kind: declaration => declaration.kind === "type-parameter" ? 10 : undefined,
    getSourceFile: declaration => declaration.file,
    getPath: sourceFile => sourceFile.path,
    pos: declaration => declaration.position,
    end: declaration => declaration.position + 1,
  };
  const parameters = declarations.map(declaration => rustSourceTypeParameter(declaration, ast));
  const origin = { fileName: file.path, declarationIdentity: "callable" };
  return { ast, declarations, parameters, origin };
}

test("callable environments bind selected source parameters without capturing a same-spelled call binder", () => {
  const { ast, declarations, parameters, origin } = input();
  const number = { kind: "source-primitive", name: "float64" };
  const string = { kind: "target-named", id: "rust.std.String" };
  const callable = rustGenericCallableTargetType([parameters[1]], [parameters[1]], parameters[1], origin, [parameters[0]]);
  const selected = bindRustCallableEnvironment(callable, {
    ast,
    sourceTypeParameterSubstitutions: new Map([[declarations[0], { sourceType: {}, carrier: number }],
      [declarations[1], { sourceType: {}, carrier: number }]]),
  });
  assert.equal(selected !== undefined, true);
  assert.deepEqual(rustGenericCallableValue(selected).environment, [number]);
  assert.deepEqual(rustGenericCallableProtocol(selected, [string]), { parameters: [string], result: string });
  assert.deepEqual(rustGenericCallableValue(callable).environment, [parameters[0]]);
});

test("selected callable environment bindings require exact checked type-parameter declarations", () => {
  const { ast, parameters, origin } = input();
  const callable = rustGenericCallableTargetType([parameters[1]], [parameters[1]], parameters[1], origin, [parameters[0]]);
  for (const declaration of [{ kind: "variable" }, { kind: "type-parameter", name: { text: "Same" } }]) {
    const selected = bindRustCallableEnvironment(callable, {
      ast, sourceTypeParameterSubstitutions: new Map([[declaration, { sourceType: {}, carrier: parameters[0] }]]),
    });
    assert.equal(selected === undefined, true);
  }
});

test("bodyless callable declarations do not invent lexical capture evidence", () => {
  assert.deepEqual(resolveRustCallableEnvironment(undefined, {}, {}, new Set()), []);
  assert.deepEqual(resolveRustCallableEnvironment({}, { ast: { body: () => undefined } }, {}, new Set()), []);
  assert.equal(bindRustCallableEnvironment(undefined, {}), undefined);
});
