import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { selectedMemberReceiverCarrier } from "../../../dist/analysis/operations/members/result.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";

const cases = [
  ["generic class method", "class Outer<Value> { value!: Value; read() { return this.value; } }"],
  ["generic class accessor", "class Outer<Value> { value!: Value; get read() { return this.value; } }"],
  ["constructor", "class Outer { value = 1; constructor() { this.value; } }"],
  ["class method arrow", "class Outer { value = 1; read() { return () => this.value; } }"],
  ["class field arrow", "class Outer { value = 1; read = () => this.value; }"],
  ["object method in class", "class Outer { value = 1; read() { return { value: 2, read() { return this.value; } }; } }"],
  ["object method arrow", "class Outer { read() { return { value: 2, read() { return () => this.value; } }; } }"],
  ["object property arrow", "class Outer { value = 1; read() { return { read: () => this.value }; } }"],
  ["explicit ordinary function receiver", "class Outer { read() { return function(this: { value: number }) { return this.value; }; } }"],
  ["ordinary function without receiver", "class Outer { read() { return function(this: void) { return this; }; } }"],
  ["nested class", "class Outer { read() { return class Inner { value = 2; read() { return this.value; } }; } }"],
  ["static method", "class Outer { static value = 1; static read() { return this.value; } }"],
];

function fixture(text) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { "/src/index.ts": text },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the original receiver boundary is checked without an invented instance");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/src/index.ts");
  const receivers = [];
  const visit = node => {
    if (["KindThisExpression", "KindThisKeyword"].includes(source.ast.kindName(node))) receivers.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  assert.equal(receivers.length, 1, "the control has one actual checked this expression");
  const receiver = receivers[0];
  const semantics = source.semantics.forFile(file);
  const declaredType = semantics.types.expressionType(receiver);
  assert.equal(declaredType !== undefined, true, "the receiver retains its exact checked source type");
  const records = {
    selectedOperation: new Map(), preparedOperationResult: new Map(), flowReadProjection: new Map(),
    flowReadProjections: { validate: () => undefined },
  };
  const context = { ast: source.ast, records, currentSemantics: semantics, currentSourceFile: file,
    semanticsFor: source.semantics.forNode, typeDefinitions: createRustTypeDefinitionRegistry().seal(),
    source: { ...source, semantics: { ...source.semantics,
      selectValueTypeRefinement: () => ({ kind: "resolved", declaredType }) } },
  };
  const options = { projectTypes: { definitionContainingDeclaration() {
    assert.fail("the selected physical receiver must not be replaced by its lexical class");
  } }, sourceTypes: { sourceUnionForCarrier: () => undefined } };
  return { receiver, records, context, options, request: { receiver, sourceReceiverType: declaredType } };
}

for (const [name, source] of cases) test(`selected member receiver preserves ${name} physical authority`, () => {
  const input = fixture(source);
  const carrier = rustStructuralObjectTargetType("/src/index.ts", [{ sourceName: "value",
    type: rustSourcePrimitiveTargetType("int32"), readonly: false, presence: "required" }]);
  const other = rustSourcePrimitiveTargetType("float64");
  input.records.preparedOperationResult.set(input.receiver, { resultCarrier: other });
  input.records.selectedOperation.set(input.receiver, { resultType: carrier });
  assert.equal(selectedMemberReceiverCarrier(input.request, input.context, input.options) === carrier, true,
    "the exact selected operation wins over prepared evidence and lexical ownership");
  input.records.selectedOperation.delete(input.receiver);
  input.records.preparedOperationResult.set(input.receiver, { resultCarrier: carrier });
  assert.equal(selectedMemberReceiverCarrier(input.request, input.context, input.options) === carrier, true,
    "the exact prepared receiver is retained when no selected operation exists");
  assert.equal(selectedMemberReceiverCarrier({ ...input.request, sourceReceiverType: undefined }, input.context, input.options), undefined,
    "physical evidence does not waive the required checked source receiver type");
});

test("selected member receiver retains optional and flow projection correspondence", () => {
  const input = fixture("class Outer { value = 1; read() { return this.value; } }");
  const selected = rustSourcePrimitiveTargetType("int32");
  const optional = rustOptionTargetType(selected);
  input.records.selectedOperation.set(input.receiver, { resultType: optional });
  assert.equal(selectedMemberReceiverCarrier({ ...input.request, optionalChain: true }, input.context, input.options) === selected, true,
    "optional access consumes the actual selected optional payload without a lexical class reconstruction");
  const fact = { kind: "option-value", sourceCarrier: optional, selectedCarrier: selected };
  input.records.flowReadProjection.set(input.receiver, fact);
  input.records.flowReadProjections.validate = () => ({ kind: "projection", fact });
  assert.equal(selectedMemberReceiverCarrier(input.request, input.context, input.options) === selected, true,
    "the existing physical flow projection remains authoritative");
  input.records.flowReadProjection.set(input.receiver, { ...fact, sourceCarrier: rustSourcePrimitiveTargetType("bool") });
  assert.equal(selectedMemberReceiverCarrier(input.request, input.context, input.options), undefined,
    "an unrelated physical flow source cannot be admitted by preserving receiver evidence");
});
