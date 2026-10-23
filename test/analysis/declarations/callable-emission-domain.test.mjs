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

for (const [name, text, count] of [
  ["explicit constructor", "export class Box { value: number; constructor(value: number) { this.value = value; } } console.log(new Box(7).value);", 1],
  ["defaulted constructor", "export class Box { value: number; constructor(value: number = 7) { this.value = value; } } console.log(new Box().value);", 1],
  ["rest constructor", "export class Box { value: number; constructor(...values: number[]) { this.value = values.length; } } console.log(new Box(7, 8).value);", 1],
  ["parameter property constructor", "export class Box { constructor(public value: number) {} } console.log(new Box(7).value);", 1],
  ["implicit constructor", "export class Box { value: number = 7; } console.log(new Box().value);", 0],
]) {
  test(`${name} publishes its source value vector without an ordinary function result`, () => {
    const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
    const declaration = nodes(program).find(program.source.ast.is.IsClassDeclaration);
    const selected = program.records.nativeClass.get(declaration);
    const contract = selected.constructorContract;
    assert.equal(contract.kind === "source" ? contract.parameters.length : contract.nativeParameters.length, count,
      "the exact authored or native value vector is complete");
    assert.equal(Object.isFrozen(contract) && Object.isFrozen(contract.nativeParameters) &&
      (contract.kind !== "source" || Object.isFrozen(contract.parameters)), true, "constructor value parameters are sealed");
    assert.equal(contract.kind === "source" ? contract.parameters.every(parameter => program.records.callableParameter.get(parameter) !== undefined)
      : contract.nativeParameters.every(parameter => parameter.targetParameter.type !== undefined), true,
      "every selected source parameter retains the complete native formal ABI");
    assert.equal(contract.kind === "source" ? contract.parameters.every(parameter => program.source.ast.parent(parameter) === selected.constructor)
      : "parameters" in contract === false, true,
      "the vector retains the actual checked constructor declaration identities");
    assert.equal(selected.constructor === undefined || program.records.callableDeclaration.get(selected.constructor) === undefined, true,
      "constructors are not forced through ordinary function return admission");
  });
}

for (const [name, text] of [
  ["abstract method", `abstract class Base { abstract read(value: number): number; }
class Derived extends Base { read(value: number): number { return value + 1; } }
function run(value: Base): number { return value.read(2); }
console.log(run(new Derived()));`],
  ["interface method with receiver annotation", `interface Reader { read(this: void, value: number): number; }
class Derived implements Reader { read(this: void, value: number): number { return value + 1; } }
function run(value: Reader): number { return value.read(2); }
console.log(run(new Derived()));`],
]) {
  test(`${name} publishes value parameters on its contract signature without requiring a body`, () => {
    const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
    const ast = program.source.ast;
    const contracts = nodes(program).filter(node => ast.body(node) === undefined &&
      (ast.is.IsMethodDeclaration(node) || ast.kindName(node) === "KindMethodSignature"));
    assert.equal(contracts.length, 1, "one authored bodyless contract is covered");
    const contract = contracts[0];
    const selected = program.records.projectCallableSignature.get(contract);
    assert.equal(selected !== undefined, true, "the existing contract owner publishes the selected signature");
    assert.equal(selected.contract.parameters.length, 1, "only the actual source value parameter enters the native ABI");
    assert.equal(Object.isFrozen(selected.contract.parameters), true, "the contract value vector is immutable");
    assert.equal(selected.contract.parameters.every(parameter => ast.parent(parameter) === contract), true,
      "the vector retains its original checked contract declaration identities");
    assert.equal(selected.contract.parameters.every(parameter => program.records.callableParameter.get(parameter) !== undefined), true,
      "every contract parameter has the complete native formal ABI");
    assert.equal(program.records.callableDeclaration.get(contract) === undefined, true,
      "signature-only contracts never require an ordinary body or return record");
  });
}
