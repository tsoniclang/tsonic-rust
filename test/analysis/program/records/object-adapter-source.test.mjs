import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

const cases = [
  ["receiverIndependentMethod", `
    export function run(): number {
      const original = { count: 1, value(input: number): number { return input + 1; } };
      const { count, ...copy } = original;
      return copy.value(count);
    }
  `],
  ["classValue", `
    class Box { static flag: number = 3; constructor(public value: number) {} }
    export function run(): number { const constructor = Box; return new constructor(2).value + constructor.flag; }
  `],
  ["classValue", `
    class Box { static flag: number = 3; constructor(public value: number) {} }
    interface Factory { new(value: number): Box; flag: number; }
    function make(factory: Factory): number { return new factory(2).value + factory.flag; }
    export function run(): number { return make(Box); }
  `],
  ["objectLiteralMethodAdapter", `
    interface Identity { apply<T>(value: T): T; }
    function make(): Identity { return { apply<T>(value: T): T { return value; } }; }
    export function run(): number { return make().apply(3); }
  `],
  ["projectCallableAdapters", `
    class Base { value(input: number): number { return input; } }
    class Derived extends Base { value(input: number): number { return input + 1; } }
    export function run(): number { const base: Base = new Derived(); return base.value(3); }
  `],
  ["objectReferenceView", `
    class Box { static flag: number = 3; constructor(public value: number) {} }
    interface Factory { new(value: number): Box; flag: number; }
    export function run(): number {
      const native = Box;
      const view: Factory = native;
      return new view(2).value + view.flag;
    }
  `, "constructor"],
  ["objectReferenceView", `
    class Box { value: number = 1; }
    function read(box: { value: number }): number { return box.value; }
    export function run(): number { return read(new Box()); }
  `, "project"],
  ["objectReferenceView", `
    export function run(): number {
      const original = { name: "hello", count: 1 };
      const view: { count: number } = original;
      view.count = 2;
      return original.count;
    }
  `, "structural"],
];

function checkedNodes(source, program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return nodes;
}

for (const surfaces of [[], ["js"]]) {
  for (const [index, [family, text, viewKind]] of cases.entries()) {
    test(`${family} producer retains checked source, selected ABI and immutable readers in ${surfaces[0] ?? "native"} case ${index}`, () => {
      const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": text } });
      const nodes = checkedNodes(source, program);
      const identities = new Set(nodes);
      const { ast } = source;
      const initializer = name => ast.as.AsVariableDeclaration(nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === name))?.Initializer;
      const expectedSubjects = index === 0 ? nodes.filter(node => ast.is.IsMethodDeclaration(node) && ast.text(ast.name(node)) === "value") :
        index === 1 ? [initializer("constructor")] :
        index === 2 ? [ast.arguments(nodes.find(node => ast.is.IsCallExpression(node)))[0]] :
        index === 3 ? nodes.filter(node => ast.is.IsObjectLiteralExpression(node)) :
        index === 4 ? nodes.filter(node => ast.is.IsClassDeclaration(node)) :
        index === 6 ? nodes.filter(node => ast.is.IsNewExpression(node)) : [initializer("view")];
      assert.equal(expectedSubjects.length, index === 4 ? 2 : 1);
      for (const subject of expectedSubjects) assertRustRecordRequirement(requiredRecords, family, subject);
      const selected = nodes.flatMap(node => {
        const fact = program.records[family].get(node);
        return fact === undefined ? [] : [{ node, fact }];
      });
      assert.equal(selected.length > 0, true, `${family}: actual source publication`);
      assert.equal(Object.isFrozen(program.records[family]), true);
      assert.equal(program.records[family].set === undefined, true);
      assert.equal(program.records[family].get({}) === undefined, true);
      for (const { node, fact } of selected) {
        if (family === "receiverIndependentMethod") {
          assert.equal(source.ast.kindName(node), "KindMethodDeclaration");
          const operations = nodes.map(subject => program.records.targetOperation.get(subject)).filter(operation =>
            operation?.kind === "record-literal" && operation.storage === "structural-object");
          assert.equal(operations.some(operation => operation.contributions.some(contribution =>
            contribution.kind === "structural-method" && contribution.expression === node &&
              operation.fields.some(field => field.storageIndex === contribution.targetStorageIndex &&
                rustTargetTypeRefEquals(field.carrier, fact.carrier)))), true, "exact selected copied-method carrier");
        } else if (family === "classValue") {
          assert.equal(identities.has(fact.declaration), true, "checked class declaration identity");
          assert.equal(program.projectTypes.definitionForCarrier(fact.sourceCarrier)?.declaration === fact.declaration, true);
          assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, fact.carrier), true);
        } else if (family === "objectLiteralMethodAdapter") {
          const operation = program.records.targetOperation.get(node);
          assert.equal(operation?.kind, "record-literal");
          assert.equal(fact.implementations.length > 0, true);
          assert.equal(fact.dispatches.length > 0, true);
          assert.equal(Object.isFrozen(fact.implementations), true);
          assert.equal(Object.isFrozen(fact.dispatches), true);
          for (const implementation of fact.implementations) {
            assert.equal(identities.has(implementation.sourceCallable), true);
            assert.equal(operation.contributions.some(contribution => contribution.kind === "method" &&
              contribution.expression === implementation.sourceCallable), true);
            assert.equal(Object.isFrozen(implementation.parameters), true);
          }
          for (const dispatch of fact.dispatches) {
            assert.equal(identities.has(dispatch.contractMethod), true);
            assert.equal(fact.implementations[dispatch.implementationIndex] !== undefined, true);
            assert.equal(Object.isFrozen(dispatch.parameterAdapters), true);
          }
        } else if (family === "projectCallableAdapters") {
          assert.equal(Object.isFrozen(fact), true);
          assert.equal(fact.length > 0, true);
          for (const adapter of fact) {
            assert.equal(identities.has(adapter.contract), true);
            assert.equal(identities.has(adapter.implementation), true);
            assert.equal(adapter.parameterAdapters.length, 1);
            assert.equal(adapter.parameterAdapters[0].kind, "runtime-value");
            assert.equal(adapter.parameterAdapters[0].adapter.kind, "identity");
            assert.equal(Object.isFrozen(adapter), true);
          }
        } else {
          assert.equal(fact.kind, viewKind);
          assert.equal(rustTargetTypeRefEquals(fact.sourceCarrier, fact.targetCarrier), false);
          if (fact.kind !== "structural") assert.equal(identities.has(fact.declaration), true);
          else {
            assert.equal(fact.fields.length, 1);
            assert.equal(fact.fields[0].destinationIndex, 0);
            assert.equal(fact.fields[0].writable, true);
            assert.equal(fact.fields[0].source.storageIndex, 0);
            assert.equal(Object.isFrozen(fact.fields), true);
          }
        }
      }
    });
  }

  test(`a declaration used only as a static qualifier does not manufacture a class-value record in ${surfaces[0] ?? "native"}`, () => {
    const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      class Box { static value: number = 3; }
      export function run(): number { return Box.value; }
    ` } });
    const nodes = checkedNodes(source, program);
    assert.equal(nodes.some(node => program.records.classValue.get(node) !== undefined), false);
    assert.equal(requiredRecords.some(row => row.family === "classValue"), false);
  });
}
