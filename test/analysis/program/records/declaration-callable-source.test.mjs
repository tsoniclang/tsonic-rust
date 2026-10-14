import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { isRustUnitCarrier } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

function checkedNodes(program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return nodes;
}

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`ambient and callable aliases publish only their actual checked declaration identities in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      declare const seed: number;
      interface Phantom { field: typeof seed; }
      interface Callable { (value: number): number; }
      export function run(invoke: Callable): number { return invoke(2); }
    ` } });
    const nodes = checkedNodes(program);
    const { ast } = program.source;
    const selected = nodes.filter(node => program.records.typeOnlyDeclaration.get(node) !== undefined);
    assert.equal(selected.length, 3, "one ambient statement, its declaration, and one callable facade");
    for (const node of selected) {
      const fact = program.records.typeOnlyDeclaration.get(node);
      assert.equal(fact.reason, ast.is.IsInterfaceDeclaration(node) ? "representation-alias" : "ambient");
    }
    const ordinary = nodes.find(node => ast.is.IsInterfaceDeclaration(node) && ast.text(ast.name(node)) === "Phantom");
    assert.equal(ordinary !== undefined, true);
    assert.equal(program.records.typeOnlyDeclaration.get(ordinary) === undefined, true, "an ordinary structural interface is not erased");
    assert.equal(program.records.typeOnlyDeclaration.get({}) === undefined, true);
    assert.equal(program.records.typeOnlyDeclaration.set === undefined, true);
  });

  test(`module bindings preserve native constant, live-cell and default-export storage in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      const answer: number = 7;
      let counter: number = 1;
      export function run(): number { counter += 1; return counter + answer; }
      export default answer;
    ` } });
    const { ast } = program.source;
    const nodes = checkedNodes(program);
    for (const [name, kind, storage] of [["answer", "const", "native-const"], ["counter", "let", "module-cell"]]) {
      const declaration = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === name);
      assert.equal(declaration !== undefined, true, name);
      const binding = program.records.moduleBinding.get(declaration);
      assert.equal(binding?.declarationKind, kind, name);
      assert.equal(binding?.storage, storage, name);
      assert.equal(rustTargetTypeRefEquals(binding.valueCarrier, program.records.runtimeCarrier.get(declaration)?.carrier), true, name);
    }
    const exported = nodes.find(node => ast.kindName(node) === "KindExportAssignment");
    assert.equal(exported !== undefined, true);
    const binding = program.records.moduleBinding.get(exported);
    assert.equal(binding?.storage, "module-cell");
    assert.equal(binding.initialization, "value");
    assert.equal(program.records.moduleBinding.set === undefined, true);
  });

  for (const [name, source, kind] of [
    ["inline generic", `function step<T>(value: T): T { return value; }
      export function run(): number { const callback = step; return callback(2); }`, "inline"],
    ["stored", `function step(value: number): number { return value + 1; }
      export const callback: (value: number) => number = step;`, "stored"],
  ]) test(`module ${name} callable storage retains the actual function declaration and value ABI in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const { ast } = program.source;
    const nodes = checkedNodes(program);
    const step = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "step");
    assert.equal(step !== undefined, true);
    const binding = program.records.moduleBinding.get(step);
    assert.equal(binding?.storage, "native-callable");
    assert.equal(binding.callableDeclaration === step, true);
    assert.equal(binding.value !== undefined, true);
    assert.equal(rustTargetTypeRefEquals(binding.value.resultCarrier, program.records.sourceCallableReturn.get(step)?.returnCarrier), true);
    assert.equal(program.records.moduleCallableStorage.get(step)?.kind, kind);
    assert.equal(Object.isFrozen(program.records.moduleCallableStorage.get(step)), true);
    assert.equal(program.records.moduleCallableStorage.set === undefined, true);
  });

  test(`source return inference keeps exact native integer carriers without result annotations in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      function identity(value: int32) { return value; }
      export function run(value: int32) { return identity(value); }
    ` } });
    const { ast } = program.source;
    const functions = checkedNodes(program).filter(node => ast.is.IsFunctionDeclaration(node));
    assert.equal(functions.length, 2);
    for (const declaration of functions) {
      const fact = program.records.sourceCallableReturn.get(declaration);
      assert.equal(fact?.returnCarrier.kind, "source-primitive");
      assert.equal(fact.returnCarrier.name, "int32");
      assert.equal(fact.canFallThrough, false);
      assert.equal(program.records.sourceCallableReturn.set === undefined, true);
    }
  });

  test(`source return records preserve explicit native reference contracts without inventing a local loan in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      import type { Life, Ref } from "@tsonic/rust/types.js";
      import type { int32 } from "@tsonic/core/types.js";
      export function borrowed<Region extends Life>(value: Ref<int32, Region>): Ref<int32, Region> { return value; }
    ` } });
    const { ast } = program.source;
    const declaration = checkedNodes(program).find(node => ast.is.IsFunctionDeclaration(node));
    assert.equal(declaration !== undefined, true);
    const fact = program.records.sourceCallableReturn.get(declaration);
    const parameter = ast.parameters(declaration)[0];
    assert.equal(fact?.borrowedParameter === undefined, true, "an exported explicit native contract is not a local call-site loan optimization");
    assert.equal(fact.returnCarrier.kind, "reference");
    assert.equal(fact.returnCarrier.lifetime.name, "Region");
    assert.equal(rustTargetTypeRefEquals(fact.returnCarrier, program.records.sourceParameterAbi.get(parameter)?.valueCarrier), true);
  });

  test(`source absence completion and setter unit results remain explicit in sealed data in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      export function selected(value: boolean): string | undefined { if (value) return "ready"; }
      class Box { value = 1; set next(value: number) { this.value = value; } }
      export function run(): Box { return new Box(); }
    ` } });
    const { ast } = program.source;
    const nodes = checkedNodes(program);
    const declaration = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "selected");
    assert.equal(declaration !== undefined, true);
    const result = program.records.sourceCallableReturn.get(declaration);
    assert.equal(result?.canFallThrough, true);
    assert.equal(result.undefinedReturn, true);
    assert.equal(result.fallthroughUndefined, true);
    const setter = nodes.find(node => ast.kindName(node) === "KindSetAccessor");
    assert.equal(setter !== undefined, true);
    assert.equal(isRustUnitCarrier(program.records.sourceCallableReturn.get(setter)?.returnCarrier), true);
  });
}
