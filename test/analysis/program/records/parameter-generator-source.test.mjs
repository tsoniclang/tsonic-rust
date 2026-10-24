import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { getRustGeneratorProtocol, rustGeneratorTargetType, rustAsyncGeneratorTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

const integer = 'import type { int32 } from "@tsonic/core/types.js";';

function fixture(text, surfaces) {
  const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": integer + text } });
  const { ast } = program.source;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.filter(file => ast.getFileName(file) === "/src/index.ts").forEach(visit);
  return { navigation: program.sourceNavigation, ast, nodes, records: program.records, requiredRecords };
}

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`checked ${surface} sync, delegated and async generators publish only their exact selected source protocols`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      function* inner(seed: int32): Generator<int32, int32, int32> { const next: int32 = yield seed; return next; }
      export function* outer(seed: int32): Generator<int32, int32, int32> { return yield* inner(seed); }
      export async function* asynchronous(seed: int32): AsyncGenerator<int32, int32, int32> { const next: int32 = yield seed; return next; }
      export function plain(seed: int32): int32 { return seed; }
    `, surfaces);
    const declarations = nodes.filter(node => ast.is.IsFunctionDeclaration(node));
    assert.equal(declarations.length, 4);
    let count = 0;
    for (const declaration of declarations) {
      const name = ast.text(ast.name(declaration));
      const fact = records.generator.get(declaration);
      if (name === "plain") {
        assert.equal(fact === undefined, true, name);
        continue;
      }
      count++;
      assertRustRecordRequirement(requiredRecords, "generator", declaration);
      assert.equal(fact !== undefined && Object.isFrozen(fact), true, name);
      assert.equal(fact.kind, name === "asynchronous" ? "async" : "sync", name);
      assert.equal(fact.capturedParameters.every(parameter => ast.parameters(declaration).includes(parameter)), true, name);
      for (const field of ["yieldType", "returnType", "nextType"]) {
        assert.equal(fact[field].kind, "source-primitive", name + ":" + field);
        assert.equal(fact[field].name, "int32", name + ":" + field);
      }
      assert.equal(["static", "receiver", "lifetime"].includes(fact.storage.kind), true, name + ":storage");
      if (fact.storage.kind === "lifetime") assert.equal(fact.storage.lifetime !== undefined, true, name + ":lifetime");
      const logical = fact.kind === "sync" ? rustGeneratorTargetType(fact) : rustAsyncGeneratorTargetType(fact);
      assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, logical), true, name + ":logical-source-protocol");
      assert.equal(getRustGeneratorProtocol(fact.resultCarrier)?.kind, fact.kind, name);
    }
    assert.equal(count, 3);
    const yields = nodes.filter(node => ast.kindName(node) === "KindYieldExpression");
    assert.equal(yields.length, 3);
    for (const expression of yields) {
      assertRustRecordRequirement(requiredRecords, "yield", expression);
      const selected = records.yield.get(expression);
      const owner = sourceEnclosingCallable(expression, ast);
      assert.equal(selected !== undefined && owner !== undefined, true);
      assert.equal(selected.generatorDeclaration === owner, true);
      assert.equal(selected.yieldType === records.generator.get(owner).yieldType, true);
    }
    assert.equal(records.generator.get({}) === undefined, true);
  });

  test(`checked ${surface} parameter ABI preserves required, optional, default, rest and destructuring forms`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      export function required(value: int32): int32 { return value; }
      export function optional(value?: int32): int32 { return value ?? 3; }
      export function fallback(value: int32 = 4): int32 { return value; }
      export function rest(...values: int32[]): int32 { return values[0]; }
      export function destructured({ left }: { left: int32 }, [right]: int32[]): int32 { return left + right; }
    `, surfaces);
    const expected = { required: "required", optional: "optional", fallback: "default", rest: "rest", destructured: "required" };
    const declarations = nodes.filter(node => ast.is.IsFunctionDeclaration(node));
    assert.equal(declarations.length, 5);
    for (const declaration of declarations) {
      const name = ast.text(ast.name(declaration));
      for (const parameter of ast.parameters(declaration)) {
        assertRustRecordRequirement(requiredRecords, "sourceParameterAbi", parameter);
        const abi = records.sourceParameterAbi.get(parameter);
        assert.equal(abi !== undefined && Object.isFrozen(abi), true, name);
        assert.equal(abi.form, expected[name], name);
        assert.equal(rustTargetTypeRefEquals(abi.valueCarrier, records.runtimeCarrier.get(parameter)?.carrier), true, name);
        assert.equal(abi.mode === "value" || abi.mode === "ref" || abi.mode === "mut-ref", true, name);
      }
    }
    for (const kind of ["KindObjectBindingPattern", "KindArrayBindingPattern"]) {
      const pattern = nodes.find(node => ast.kindName(node) === kind);
      assert.equal(pattern !== undefined, true, kind);
      const parameter = ast.parent(pattern);
      const abi = records.sourceParameterAbi.get(parameter);
      assert.equal(abi?.form, "required", kind);
      const native = records.callableParameter.get(parameter);
      assert.equal(native !== undefined && native.pattern === pattern, true, `${kind}: the original pattern reaches native parameter emission`);
      assert.equal(rustTargetTypeRefEquals(native.carrier, abi.parameterCarrier), true,
        `${kind}: the header consumes the actual selected native borrow or owned ABI`);
      assert.equal(rustTargetTypeRefEquals(native.sourceCarrier, abi.valueCarrier), true,
        `${kind}: the source binding value remains distinct from its native entry carrier`);
    }
    const leaves = nodes.filter(node => ast.kindName(node) === "KindBindingElement");
    assert.equal(leaves.length, 2);
    for (const leaf of leaves) assertRustRecordRequirement(requiredRecords, "bindingProjection", leaf);
    assert.equal(records.sourceParameterAbi.get({}) === undefined, true);
  });

  test(`checked ${surface} parameter references and transparent expressions share the finalized ABI identity`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      export function identity(input: int32): int32 { return (((input as int32) satisfies int32))!; }
    `, surfaces);
    const declaration = nodes.find(node => ast.is.IsFunctionDeclaration(node));
    const parameter = ast.parameters(declaration)[0];
    const selected = records.sourceParameterAbi.get(parameter);
    assert.equal(selected !== undefined, true);
    const references = nodes.filter(node => ast.is.IsIdentifier(node) && records.sourceBinding.get(node)?.sourceDeclaration === parameter);
    assert.equal(references.length, 1);
    assert.equal(records.sourceParameterAbi.get(references[0]) === selected, true);
    const kinds = ["KindAsExpression", "KindSatisfiesExpression", "KindParenthesizedExpression", "KindNonNullExpression"];
    const wrappers = nodes.filter(node => kinds.includes(ast.kindName(node)));
    assert.equal(wrappers.length >= 5, true);
    for (const wrapper of wrappers) {
      assert.equal(records.sourceParameterAbi.get(wrapper) === selected, true, ast.kindName(wrapper));
      assert.equal(records.sourceParameterAbi.get(Node_Expression(ast, wrapper)) === selected, true, ast.kindName(wrapper));
    }
    for (const kind of kinds) assert.equal(wrappers.some(node => ast.kindName(node) === kind), true, kind);
  });

  test(`checked ${surface} lexical and module bindings keep exact declaration, authored name and file identities`, () => {
    const { navigation, ast, nodes, records } = fixture(`
      const seed: int32 = 3;
      export function run(input: int32): int32 { const local: int32 = input + seed; return local + seed; }
    `, surfaces);
    const bindings = nodes.flatMap(node => {
      const fact = records.sourceBinding.get(node);
      return fact === undefined ? [] : [{ node, fact }];
    });
    assert.equal(bindings.length, 4);
    assert.deepEqual(bindings.map(({ fact }) => fact.scope).sort(), ["lexical", "lexical", "module", "module"]);
    for (const { node, fact } of bindings) {
      assert.equal(navigation.sourceReferenceFor(node)?.declaration === fact.sourceDeclaration, true, fact.sourceName);
      assert.equal(fact.sourceName, ast.text(ast.name(fact.sourceDeclaration)));
      assert.equal(Object.isFrozen(fact), true, fact.sourceName);
      if (fact.scope === "module") assert.equal(fact.fileName, "/src/index.ts");
      else assert.equal(Object.hasOwn(fact, "fileName"), false);
    }
    assert.equal(records.sourceBinding.get({}) === undefined, true);
  });

  test(`checked ${surface} parameter properties carry their constructor ABI and lexical initializer binding without a new declaration`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      class Box { constructor(public readonly value: int32) {} }
      export function run(input: int32): int32 { return new Box(input).value; }
    `, surfaces);
    const constructor = nodes.find(node => ast.kindName(node) === "KindConstructor");
    assert.equal(constructor !== undefined, true);
    const parameter = ast.parameters(constructor)[0];
    const name = ast.name(parameter);
    for (const subject of [parameter, name]) {
      assertRustRecordRequirement(requiredRecords, "sourceParameterAbi", subject);
      assertRustRecordRequirement(requiredRecords, "runtimeCarrier", subject);
    }
    assertRustRecordRequirement(requiredRecords, "sourceBinding", name);
    assert.equal(requiredRecords.some(row => row.family === "sourceBinding" && row.subject === parameter), false);
    assert.equal(name !== undefined, true);
    const binding = records.sourceBinding.get(name);
    assert.equal(binding?.scope, "lexical");
    assert.equal(binding.sourceDeclaration === parameter, true);
    assert.equal(binding.sourceName, "value");
    const abi = records.sourceParameterAbi.get(parameter);
    assert.equal(abi !== undefined && records.sourceParameterAbi.get(name) === abi, true);
    assert.equal(rustTargetTypeRefEquals(records.runtimeCarrier.get(name)?.carrier, abi.valueCarrier), true);
  });
}
