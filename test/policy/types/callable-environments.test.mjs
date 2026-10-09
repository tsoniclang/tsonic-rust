import assert from "node:assert/strict";
import test from "node:test";
import { bindRustCallableEnvironment, resolveRustCallableEnvironment } from "../../../dist/policy/types/resolution/callable-environments.js";
import { rustSourceTypeParameter } from "../../../dist/target-model/names/type-parameters.js";
import { rustGenericCallableProtocol, rustGenericCallableTargetType, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { bindRustCallableResultTypeParameters } from "../../../dist/policy/types/resolution/generic-arguments.js";

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

function resultBindings() {
  const { ast, declarations, parameters } = input();
  const callable = {};
  const owner = {};
  const sourceTypes = declarations.map(() => ({}));
  const symbols = declarations.map(() => ({}));
  const semantics = { declarations: {
    declaredType: declaration => sourceTypes[declarations.indexOf(declaration)],
    typeSymbol: type => symbols[sourceTypes.indexOf(type)],
    primarySymbolDeclaration: symbol => declarations[symbols.indexOf(symbol)],
  } };
  ast.parent = declaration => declaration === callable ? owner : undefined;
  const context = { ast, semanticsFor: () => semantics,
    sourceTypeParameterSubstitutions: new Map(),
    sourceLifetimes: { contractFor: declaration => declaration === callable || declaration === owner ? {
      parameters: [{ kind: "type", declaration: declarations[declaration === owner ? 0 : 1],
        identity: parameters[declaration === owner ? 0 : 1].identity }],
    } : undefined },
  };
  const integer = { kind: "source-primitive", name: "int64" };
  const string = { kind: "target-named", id: "rust.std.String" };
  const template = { kind: "tuple", elements: [parameters[0], parameters[1], parameters[0]] };
  const result = { kind: "tuple", elements: [integer, string, integer] };
  return { callable, owner, declarations, parameters, semantics, context, template, result, integer, string };
}

test("callable structural results bind exact enclosing and invocation parameters without mutating their template", () => {
  const input = resultBindings();
  const selected = bindRustCallableResultTypeParameters(input.callable, input.template, input.result, input.context);
  assert.equal(selected !== undefined, true, "exact checked lexical parameter owners");
  assert.deepEqual(selected.sourceTypeParameterSubstitutions.get(input.declarations[0]).carrier, input.integer);
  assert.deepEqual(selected.sourceTypeParameterSubstitutions.get(input.declarations[1]).carrier, input.string);
  assert.equal(input.context.sourceTypeParameterSubstitutions.size, 0, "source substitutions remain unchanged");
  assert.equal(input.template.elements[0] === input.parameters[0], true, "original enclosing identity is retained");
  assert.equal(input.template.elements[1] === input.parameters[1], true, "original invocation identity is retained");
});

test("callable structural results reject foreign owners, contradictory bindings and inconsistent repeated carriers", () => {
  for (const [label, mutate] of [
    ["missing enclosing contract", input => { input.context.ast.parent = () => undefined; }],
    ["cyclic lexical ancestry", input => { input.context.ast.parent = () => input.callable; }],
    ["foreign source declaration", input => { input.semantics.declarations.primarySymbolDeclaration = () => ({}); }],
    ["missing declared source type", input => { input.semantics.declarations.declaredType = () => undefined; }],
    ["conflicting existing binding", input => { input.context.sourceTypeParameterSubstitutions.set(input.declarations[0], { sourceType: {}, carrier: input.string }); }],
    ["inconsistent repeated carrier", input => { input.result.elements[2] = input.string; }],
    ["foreign capture identity", input => { input.template.elements[0] = { ...input.parameters[0], identity: "foreign" }; }],
    ["duplicate identity with different owners", input => { input.context.sourceLifetimes.contractFor = declaration => ({
      parameters: [{ kind: "type", declaration: input.declarations[declaration === input.owner ? 0 : 1], identity: input.parameters[0].identity }],
    }); }],
  ]) {
    const input = resultBindings();
    mutate(input);
    const originalSize = input.context.sourceTypeParameterSubstitutions.size;
    assert.equal(bindRustCallableResultTypeParameters(input.callable, input.template, input.result, input.context) === undefined, true, label);
    assert.equal(input.context.sourceTypeParameterSubstitutions.size, originalSize, "failed binding publishes no mutation");
  }
});
