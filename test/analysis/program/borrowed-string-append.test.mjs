import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { analyzeRustBorrowedElementReads } from "../../../dist/analysis/program/borrowed-element-reads.js";
import { analyzeRustCountedLoopRepresentations } from "../../../dist/analysis/control-flow/counted-loop-representations.js";

const sourceText = `
import type { nativeUint } from "@tsonic/core/types.js";

export function combine(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) {
    output += values[index]!;
  }
  return output;
}
`;

function functionNodes(source, program, name) {
  let declaration;
  const visit = node => {
    if (source.ast.is.IsFunctionDeclaration(node)) {
      const identifier = source.ast.name(node);
      if (identifier !== undefined && source.ast.is.IsIdentifier(identifier) &&
        source.ast.text(identifier) === name) declaration = node;
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.ok(declaration, name);
  const nodes = [];
  const collect = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
  };
  collect(declaration);
  return nodes;
}

function selectedNodes(source, program, name) {
  const nodes = functionNodes(source, program, name);
  const loop = nodes.find(node => source.ast.is.IsForStatement(node));
  const append = nodes.find(node => source.ast.is.IsBinaryExpression(node) &&
    program.facts.getFact(node, rustTargetOperationFactKey)?.operator === "+=");
  const element = nodes.find(node => source.ast.is.IsElementAccessExpression(node));
  assert.ok(loop, name);
  return { loop, append, element };
}

test("indexed string append selects one immutable borrowed read for emission and counted-loop stability", () => {
  const options = { surfaces: ["js"], files: { "index.ts": sourceText } };
  const { source, program } = analyzeRust(options);
  const { loop, append, element } = selectedNodes(source, program, "combine");
  assert.ok(append);
  assert.ok(element);
  const selected = program.borrowedElementReads.forExpression(append);
  assert.ok(selected);
  assert.equal(selected.element === element, true);
  assert.equal(program.borrowedElementReads.forRead(element) === selected, true);
  assert.ok(Object.isFrozen(selected));
  const operation = program.facts.getFact(element, rustTargetOperationFactKey);
  assert.equal(operation?.kind, "provider-operation");
  assert.equal(operation.abi.effects.evaluation, "observable");
  assert.deepEqual(operation.borrowedIndexOperation, { method: "borrow_number_element", evaluation: "pure" });
  assert.equal(program.countedLoops.representationFor(loop)?.kind, "native-counter");

  const { result } = compileRust(options);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /for index in 0(?:_usize)?\.\.values\.len\(\)/u);
  assert.match(output, /\.borrow_number_element\(array_index(?:_\d+)?\)/u);
  assert.match(output, /output\.push_str\(&element(?:_\d+)?\)/u);
  assert.doesNotMatch(output, /&\*element/u);
  assert.doesNotMatch(output, /get_number|\.clone\(\)|iter_cloned|format!|\bf64\b/u);
});

test("a merely available borrowed operation cannot establish counted-loop purity", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": sourceText } });
  const { loop, element } = selectedNodes(source, program, "combine");
  assert.ok(program.facts.getFact(element, rustTargetOperationFactKey).borrowedIndexOperation);
  const counted = analyzeRustCountedLoopRepresentations({
    ast: program.source.ast, sourceFiles: program.sourceFiles, navigation: program.sourceNavigation, facts: program.facts,
    borrowedElementReads: { ...program.borrowedElementReads, forRead: () => undefined },
  });
  assert.equal(counted.representationFor(loop) === undefined, true);
});

test("local String guards retain exact readonly uses and end before mutation", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function inspect(values: string[]): number {
  const field = values[0];
  if (field === "") return 0;
  const length = field.length;
  const amount = parseInt(field, 10);
  values[0] = "99";
  return length + amount;
}
export function retained(values: string[]): string {
  const field = values[0];
  values[0] = "changed";
  return field;
}
` } });
  const inspectNodes = functionNodes(source, program, "inspect");
  const selected = inspectNodes.map(node => program.borrowedElementReads.forStatement(node))
    .find(local => local !== undefined);
  assert.equal(selected !== undefined, true, "one exact borrowed local is selected");
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(selected.references), true);
  assert.equal(selected.references.length, 3);
  assert.equal(new Set(selected.references).size, 3);
  for (const reference of selected.references) {
    assert.equal(source.ast.text(reference), "field");
  }
  let lastStatement = selected.references[2];
  while (lastStatement !== undefined && !source.ast.is.IsVariableStatement(lastStatement)) {
    lastStatement = source.ast.parent(lastStatement);
  }
  assert.equal(selected.lastStatement === lastStatement, true, "borrow ends at the final pure input before mutation");
  for (const node of functionNodes(source, program, "retained")) {
    assert.equal(program.borrowedElementReads.forStatement(node) === undefined, true,
      "owned snapshot across a write must not become a guard");
  }
});

test("borrowed append requires the sealed in-place write strategy and exact pure read", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": sourceText } });
  const { append, element } = selectedNodes(source, program, "combine");
  const selectedAppend = program.facts.getFact(append, rustTargetOperationFactKey);
  const selectedRead = program.facts.getFact(element, rustTargetOperationFactKey);
  const replacements = [
    [append, { ...selectedAppend, writeStrategy: undefined }],
    [append, { ...selectedAppend, writeStrategy: "preserve-before-rhs" }],
    [append, { ...selectedAppend, operator: "=" }],
    [append, { ...selectedAppend, resultCarrier: { kind: "source-primitive", name: "int32" } }],
    [element, { ...selectedRead, borrowedIndexOperation: undefined }],
    [element, { ...selectedRead, borrowedIndexOperation: { ...selectedRead.borrowedIndexOperation, evaluation: "observable" } }],
  ];
  for (const [mutationIndex, [subject, replacement]] of replacements.entries()) {
    const facts = { ...program.facts, getFact(node, key) {
      return node === subject && key === rustTargetOperationFactKey ? replacement : program.facts.getFact(node, key);
    } };
    assert.equal(facts.getFact(subject, rustTargetOperationFactKey) === replacement, true,
      `selected fact mutation ${mutationIndex}`);
    const reads = analyzeRustBorrowedElementReads(program.source.ast, program.sourceFiles, facts, program.sourceNavigation);
    assert.equal(reads.forExpression(append) === undefined, true, `append mutation ${mutationIndex}`);
    assert.equal(reads.forRead(element) === undefined, true, `read mutation ${mutationIndex}`);
    const counted = analyzeRustCountedLoopRepresentations({ ast: program.source.ast, sourceFiles: program.sourceFiles,
      navigation: program.sourceNavigation, facts, borrowedElementReads: reads }).representationFor(
      selectedNodes(source, program, "combine").loop);
    assert.equal(counted === undefined, true, `counted mutation ${mutationIndex}`);
  }
});

test("borrow selection never makes aliases, writes, unknown reads, calls, throws or suspension a stable array bound", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { nativeUint } from "@tsonic/core/types.js";

function nextIndex(): nativeUint { return 0; }
function inspect(): void {}

export function aliased(values: string[]): string {
  const alias = values;
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) output += alias[index]!;
  return output;
}
export function mutated(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) {
    output += values[index]!;
    values.push("added");
  }
  return output;
}
export function written(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) {
    output += values[index]!;
    values[index] = "updated";
  }
  return output;
}
export function called(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) {
    output += values[index]!;
    inspect();
  }
  return output;
}
export function indexedEffect(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) output += values[nextIndex()]!;
  return output;
}
export function throwing(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) {
    output += values[index]!;
    if (index === 0) throw new Error("stop");
  }
  return output;
}
export async function suspended(values: string[]): Promise<string> {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) {
    output += values[index]!;
    await 0;
  }
  return output;
}
export function captured(values: string[]): string {
  const read = (): nativeUint => values.length;
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) output += values[index]!;
  void read;
  return output;
}
export function ownedRead(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) output = output + values[index]!;
  return output;
}
export function valuedAppend(values: string[]): string {
  let output = "";
  for (let index: nativeUint = 0; index < values.length; index++) {
    const snapshot = output += values[index]!;
    void snapshot;
  }
  return output;
}
export function genericRead<T>(values: T[]): void {
  for (let index: nativeUint = 0; index < values.length; index++) void values[index];
}
` } });
  for (const name of ["aliased", "mutated", "written", "called", "indexedEffect", "throwing", "suspended",
    "captured", "ownedRead", "valuedAppend", "genericRead"]) {
    const { loop, append, element } = selectedNodes(source, program, name);
    assert.equal(program.countedLoops.representationFor(loop) === undefined, true, name);
    if (name === "ownedRead" || name === "valuedAppend" || name === "genericRead") {
      assert.equal(program.borrowedElementReads.forRead(element) === undefined, true, name);
    } else {
      assert.ok(program.borrowedElementReads.forExpression(append), name);
      assert.ok(program.borrowedElementReads.forRead(element), name);
    }
  }
});
