import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`local-binding admission follows the actual excluded native ancestor (${surface})`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
export function inspect(key: string): number {
  if (false) { const excluded = { [key]: 1 }; }
  const selected = 7;
  return selected;
}
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length > 0, true,
      "the selected native path completes actual admission, sealing and emission");
    const program = result.program;
    const ast = program.source.ast;
    const nodes = [];
    const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
    program.sourceFiles.forEach(visit);
    const guard = nodes.find(ast.is.IsIfStatement);
    const excluded = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "excluded");
    const selected = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "selected");
    assert.equal(guard !== undefined && excluded !== undefined && selected !== undefined, true,
      "all original checked declarations and their actual native guard remain in the source");
    const branch = ast.as.AsIfStatement(guard).ThenStatement;
    assert.equal(program.records.nativeUnreachable.get(branch), true,
      "the existing reachability owner marks the exact excluded ancestor");
    assert.equal(program.records.nativeUnreachable.get(excluded) === true, false,
      "an excluded descendant does not require a fabricated per-node unreachable record");
    assert.equal(program.records.localBinding.get(excluded) === undefined, true,
      "no native local binding is published for an excluded descendant");
    assert.equal(program.records.localBinding.get(selected)?.kind, "value",
      "the selected declaration still requires its real native binding and finalized carrier");
  });
}

const cases = [
  ["then reads the incoming value", "if ((marker = step()) > 0) { use(marker); return 1; } else { return 0; }", false],
  ["else reads the incoming value", "if ((marker = step()) > 0) { return 1; } else { use(marker); return 0; }", false],
  ["an absent else reaches an after-if read", "if ((marker = step()) > 0) { use(1); } use(marker); return 0;", false],
  ["both alternatives overwrite before reading", "if ((marker = step()) > 0) { marker = 11; use(marker); return 1; } else { marker = 11; use(marker); return 0; }", true],
  ["one overwrite does not hide another path", "if ((marker = step()) > 0) { marker = 11; use(marker); return 1; } else { use(marker); return 0; }", false],
  ["a read before overwrite observes the incoming value", "if ((marker = step()) > 0) { use(marker); marker = 11; return marker; } return 0;", false],
  ["exiting alternatives never observe the assigned value", "if ((marker = step()) > 0) { return 1; } else { return 0; }", true],
  ["branch-local shadows do not hide the outer read", "if ((marker = step()) > 0) { let marker = 1; use(marker); } else { let marker = 2; use(marker); } use(marker); return 0;", false],
  ["earlier operands do not observe later writes", "if (marker + (marker = step()) > 0) { return 1; } return 0;", true],
  ["later operands observe earlier writes", "if ((marker = step()) + marker > 0) { return 1; } return 0;", false],
  ["conditional arms are alternatives with a read", "if ((marker = step()) > 0 ? marker > 0 : (marker = 11) > 0) { return 1; } return 0;", false],
  ["conditional arms overwrite before reading", "if ((marker = step()) > 0 ? (marker = 11) > 0 : (marker = 12) > 0) { return 1; } return 0;", true],
  ["match-like arm observes its write", "use(ready ? (marker = step()) : 0); use(marker); return 0;", false],
  ["match-like arm overwrite hides its write", "use(ready ? (marker = step()) : 0); marker = 11; use(marker); return 0;", true],
  ["a block-value tail reaches its branch", "if (((marker = step()), 7) > 0) { use(marker); } return 0;", false],
  ["function returns never reach a later branch", "marker = step(); return 7;", true],
  ["parameter store overwritten on each continuing path", "marker = step(); if (ready) return 1; marker = 11; use(marker); return 0;", true],
];
for (const [name, body, dead] of cases) {
  test("source write liveness: " + name, () => check(body, dead));
}
for (const [name, region] of [
  ["unlabeled loop break", "while (ready) { marker = step(); break; }"],
  ["labeled loop break", "scan: while (ready) { marker = step(); break scan; }"],
  ["for break", "for (let index = 0; index < 1; index++) { marker = step(); break; }"],
  ["switch break", "switch (ready) { case true: marker = step(); break; default: break; }"],
  ["nested labeled break", "outer: while (ready) { while (ready) { marker = step(); break outer; } break; }"],
  ["scoped break", "scope: { marker = step(); break scope; }"],
]) {
  for (const dead of [false, true]) {
    test(`source abrupt successor: ${name}, ${dead ? "overwrite" : "read"}`, () =>
      check(region + (dead ? " marker = 11;" : "") + " use(marker); return 0;", dead));
  }
}
for (const label of [false, true]) {
  for (const dead of [false, true]) {
    test(`source continue successor: ${label ? "labeled" : "unlabeled"}, ${dead ? "overwrite" : "read"}`, () =>
      check(`${label ? "scan: " : ""}while (ready) { ${dead ? "marker = 11;" : "use(marker);"}
        marker = step(); continue${label ? " scan" : ""}; } return 0;`, dead));
  }
}

function check(body, dead) {
  const { program } = analyzeRust({ files: { "index.ts": `
function step(): number { return 7; }
function use(value: number): void { void value; }
export function inspect(marker: number, ready: boolean): number { use(marker); ${body} }
` } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
  const call = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "step");
  assert.equal(call !== undefined, true, "the original effectful RHS is retained once in checked source");
  const write = nodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.as.AsBinaryExpression(node).Right === call);
  assert.equal(write !== undefined, true, "the effect still belongs to its exact source assignment");
  const target = ast.as.AsBinaryExpression(write).Left;
  const observation = program.records.unobservedWrite.get(target);
  assert.equal(observation?.kind, "lexical", "ordinary writes retain their lexical native context");
  assert.equal(observation.unobserved, dead,
    "the source flow owner decides observation across the actual control-flow successors before sealing");
  assert.equal(nodes.filter(node => node === call).length, 1, "the effect is never duplicated");
}

for (const [name, initial, body, operator, dead] of [
  ["nullish value survives its overwritten storage", "let marker: number | undefined = undefined;",
    "const selected = marker ??= step(); marker = 11; return selected + marker;", "KindQuestionQuestionEqualsToken", true],
  ["nullish branch reads retain the stored payload", "let marker: number | undefined = undefined;",
    "if ((marker ??= step()) > 0) return marker; return 0;", "KindQuestionQuestionEqualsToken", false],
  ["compound value survives its overwritten storage", "let marker = 1;",
    "const selected = marker += step(); marker = 11; return selected + marker;", "KindPlusEqualsToken", true],
  ["compound later reads observe the store", "let marker = 1;",
    "const selected = marker += step(); return selected + marker;", "KindPlusEqualsToken", false],
]) test(`valued write observation: ${name}`, () => {
  const { result } = compileRust({ files: { "index.ts": `
function step(): number { return 7; }
export function inspect(): number { ${initial} ${body} }
` } });
  assert.equal(result.diagnostics.length, 0, `${name}: the real checked source is admitted`);
  assert.equal(result.program !== undefined, true, `${name}: all selected write records are published`);
  const program = result.program;
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const write = nodes.find(node => ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === operator);
  assert.equal(write !== undefined, true, `${name}: preserve the exact original valued assignment`);
  const target = ast.as.AsBinaryExpression(write).Left;
  const observation = program.records.unobservedWrite.get(target);
  assert.equal(observation?.kind, "lexical", `${name}: the valued write retains its lexical native context`);
  assert.equal(observation.unobserved, dead, `${name}: the existing flow producer decides storage observation`);
  const effect = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "step");
  assert.equal(effect !== undefined && ast.as.AsBinaryExpression(write).Right === effect, true,
    `${name}: the effect remains the exact one source RHS`);
  const output = rustSourceText(result);
  assert.equal((output.match(/step\(\)/gu) ?? []).length, 2, `${name}: one function declaration and one actual evaluation`);
  assert.equal(output.includes('expect(unused_assignments, reason = "checked source evaluation order")'), dead,
    `${name}: only the selected dead store has the existing checked warning disposition`);
});

for (const [name, update, after, dead] of [
  ["prefix result with overwritten storage", "++marker", "marker = 11; return selected;", true],
  ["prefix result with observed storage", "++marker", "return selected + marker;", false],
  ["postfix old result with overwritten new storage", "marker++", "marker = 11; return selected;", true],
  ["postfix result with observed new storage", "marker++", "return selected + marker;", false],
]) test(`update write observation: ${name}`, () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function inspect(): number { let marker = 1; const selected = ${update}; ${after} }
` } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const selected = nodes.find(node => ast.is.IsPrefixUnaryExpression(node) || ast.is.IsPostfixUnaryExpression(node));
  assert.equal(selected !== undefined, true, `${name}: the original native update is retained`);
  const target = ast.is.IsPrefixUnaryExpression(selected) ? ast.as.AsPrefixUnaryExpression(selected).Operand
    : ast.as.AsPostfixUnaryExpression(selected).Operand;
  assert.equal(target !== undefined, true, `${name}: the update retains its exact source target`);
  const observation = program.records.unobservedWrite.get(target);
  assert.equal(observation?.kind, "lexical", `${name}: the update retains its lexical native context`);
  assert.equal(observation.unobserved, dead,
    `${name}: result use never falsely makes the overwritten storage value live`);
});

for (const [name, after, expected] of [
  ["a first body store is overwritten before materialization", 'this.value = "done";', true],
  ["an actual field read observes the first body store", 'observe(this.value); this.value = "done";', false],
  ["every native branch overwrites before materialization", 'if (flag) this.value = "yes"; else this.value = "no";', true],
  ["one native branch retains the first body store", 'if (flag) this.value = "yes";', false],
  ["receiver publication observes the first body store", 'this.publish(); this.value = "done";', false],
  ["an early native layer return observes the first body store", 'if (flag) return; this.value = "done";', false],
  ["finally observes the first body store on an exceptional path", 'try { if (flag) throw new Error("stop"); this.value = "done"; } finally { observe(this.value); }', false],
]) test(`constructor body write observation: ${name}`, () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function observe(value: string): void { void value; }
class Value {
  value: string;
  constructor(flag: boolean) { this.value = "kept"; ${after} }
  publish(): void { observe(this.value); }
  read(): string { return this.value; }
}
export function inspect(flag: boolean): string { return new Value(flag).read(); }
` } });
  const ast = program.source.ast;
  const definition = program.projectTypes.definitions.find(selected => ast.text(ast.name(selected.declaration)) === "Value");
  assert.equal(definition !== undefined, true, `${name}: the checked source has its actual native definition`);
  const plan = program.records.classConstruction.get(definition.declaration);
  assert.equal(plan !== undefined, true, `${name}: the complete physical construction is already admitted`);
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const first = nodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.is.IsStringLiteral(ast.as.AsBinaryExpression(node).Right) && ast.text(ast.as.AsBinaryExpression(node).Right) === "kept");
  assert.equal(first !== undefined, true, `${name}: the original first store and its RHS remain`);
  const target = ast.as.AsBinaryExpression(first).Left;
  const observation = program.records.unobservedWrite.get(target);
  const layer = plan.layers.find(selected => selected.definition === definition);
  assert.equal(layer !== undefined, true, `${name}: select the identical actual native root layer`);
  assert.equal(observation?.kind, "construction", `${name}: the write retains its actual construction contexts`);
  assert.equal(observation.layers.get(layer), expected,
    `${name}: explicit and implicit native observations are counted before publication`);
  const projection = plan.emission.preparations.get(target)?.projections.find(selected => selected.expression.node === target);
  assert.equal(projection?.kind === "local" && projection.storage === "value", true,
    `${name}: only the actual plain field-local write is eligible for a native assignment warning`);
  assert.equal(nodes.filter(node => node === first).length, 1, `${name}: no store or evaluation is removed or duplicated`);
});

for (const [name, abstractBase, initializer, expected, exported] of [
  ["a real base export observes the first body store", false, ' = "initial"', false, true],
  ["a shared AST cannot expect a warning in its observing standalone context", false, "", false, false],
  ["an abstract base has only its actual non-exporting derived context", true, "", true, false],
]) test(`constructor replay write observation: ${name}`, () => {
  const { program } = analyzeRust({ files: { "index.ts": `
${abstractBase ? "abstract " : ""}class Base {
  value: string${initializer};
  constructor() { this.value = "kept"; }
}
class Derived extends Base {
  constructor() { super(); this.value = "done"; }
}
export function inspect(): string { return ${abstractBase ? "" : "new Base().value + "}new Derived().value; }
` } });
  const ast = program.source.ast;
  const base = program.projectTypes.definitions.find(selected => ast.text(ast.name(selected.declaration)) === "Base");
  const derived = program.projectTypes.definitions.find(selected => ast.text(ast.name(selected.declaration)) === "Derived");
  assert.equal(base !== undefined && derived !== undefined, true, `${name}: retain both actual checked definitions`);
  const derivedPlan = program.records.classConstruction.get(derived.declaration);
  assert.equal(derivedPlan !== undefined, true, `${name}: the real derived physical context is published`);
  const basePlan = program.records.classConstruction.get(base.declaration);
  assert.equal(basePlan !== undefined, !abstractBase,
    `${name}: abstract constructors are never invented as standalone emitting contexts`);
  const field = derivedPlan.fields.find(selected => ast.text(ast.name(selected.declaration)) === "value");
  assert.equal(field !== undefined, true, `${name}: retain the exact inherited physical field`);
  assert.equal(derivedPlan.localFieldDeclarations.has(field.declaration), exported,
    `${name}: native tuple observations come from the existing final binding-declaration plan`);
  const derivedBaseLayer = derivedPlan.layers.find(layer => layer.definition === base);
  const constructor = derivedBaseLayer?.constructor;
  assert.equal(constructor !== undefined, true, `${name}: replay the identical checked base constructor AST`);
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  visit(constructor);
  const first = nodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.is.IsStringLiteral(ast.as.AsBinaryExpression(node).Right) && ast.text(ast.as.AsBinaryExpression(node).Right) === "kept");
  assert.equal(first !== undefined, true, `${name}: the first base store is preserved`);
  const observation = program.records.unobservedWrite.get(ast.as.AsBinaryExpression(first).Left);
  assert.equal(observation?.kind, "construction", `${name}: native replay keeps its exact per-layer dispositions`);
  assert.equal([...observation.layers.values()].every(value => value), expected,
    `${name}: the old global conjunction remains a safety check over all actual native contexts`);
  assert.equal(observation.layers.size, abstractBase ? 1 : 2, `${name}: every and only actual emitting context is recorded`);
  assert.equal(observation.layers.get(derivedBaseLayer), !exported,
    `${name}: only a real intermediate native export observes the inherited first store`);
  if (basePlan !== undefined) {
    const standaloneLayer = basePlan.layers.find(layer => layer.definition === base);
    assert.equal(standaloneLayer !== undefined && standaloneLayer !== derivedBaseLayer, true,
      `${name}: the same source constructor has distinct actual standalone and inherited layers`);
    assert.equal(observation.layers.get(standaloneLayer), false,
      `${name}: standalone final materialization observes the identical first store`);
  }
  const derivedLayer = derivedPlan.layers.find(layer => layer.definition === derived);
  assert.equal(derivedLayer?.constructor !== undefined, true, `${name}: retain the actual final native constructor layer`);
  const finalNodes = [];
  const visitFinal = node => { finalNodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visitFinal(child); }); };
  visitFinal(derivedLayer.constructor);
  const finalWrite = finalNodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.is.IsStringLiteral(ast.as.AsBinaryExpression(node).Right) && ast.text(ast.as.AsBinaryExpression(node).Right) === "done");
  assert.equal(finalWrite !== undefined, true, `${name}: preserve the final store and its actual source RHS`);
  const finalObservation = program.records.unobservedWrite.get(ast.as.AsBinaryExpression(finalWrite).Left);
  assert.equal(finalObservation?.kind, "construction", `${name}: the final write has its actual layer record`);
  assert.equal(finalObservation.layers.get(derivedLayer), false, `${name}: final materialization observes the derived store`);
});

for (const [label, initializer, constructorBody, argument, expected] of [
  ["a following body reads the inherited value before overwriting", "", `constructor() {
    super(); const previous = this.value; this.value = "done"; this.observed = previous;
  }`, "", false],
  ["a following body overwrites before reading", "", `constructor() {
    super(); this.value = "done"; this.observed = this.value;
  }`, "", true],
  ["one following branch reads before the common overwrite", "", `constructor(keep: boolean) {
    super(); this.observed = keep ? this.value : "unused"; this.value = "done";
  }`, "keep", false],
  ["an implicit layer initializer reads the inherited value", " = this.value", "", "", false],
  ["an implicit layer initializer overwrites the inherited value", ' = (this.value = "done")', "", "", true],
  ["implicit initializers read before a later field overwrites", ' = this.value; later: string = (this.value = "done")', "", "", false],
  ["implicit initializers overwrite before a later field reads", ' = (this.value = "done"); later: string = this.value', "", "", true],
]) test(`constructor continuation observes actual native layers: ${label}`, () => {
  const sourceText = `
class Base {
  value: string;
  constructor() { this.value = "kept"; }
}
class Derived extends Base {
  observed: string${initializer};
  ${constructorBody}
}
export function inspect(keep: boolean): string {
  const value = new Derived(${argument});
  return value.observed + value.value;
}
`;
  const { result } = compileRust({ files: { "index.ts": sourceText } });
  const { program } = result;
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [],
    `${label}: the complete constructor source remains admitted`);
  assert.equal(program !== undefined, true, `${label}: the actual native-emission program is available`);
  const { ast } = program.source;
  const base = program.projectTypes.definitions.find(definition => ast.text(ast.name(definition.declaration)) === "Base");
  const derived = program.projectTypes.definitions.find(definition => ast.text(ast.name(definition.declaration)) === "Derived");
  assert.equal(base !== undefined && derived !== undefined, true, `${label}: both exact source definitions remain`);
  const plan = program.records.classConstruction.get(derived.declaration);
  assert.equal(plan !== undefined, true, `${label}: the complete actual derived construction is sealed`);
  const layer = plan.layers.find(selected => selected.definition === base);
  assert.equal(layer?.constructor !== undefined, true, `${label}: the exact replayed base constructor is retained`);
  const assignments = [];
  const visit = node => {
    if (ast.is.IsBinaryExpression(node)) {
      const expression = ast.as.AsBinaryExpression(node);
      if (ast.is.IsStringLiteral(expression.Right) && ast.text(expression.Right) === "kept") assignments.push(expression);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(layer.constructor);
  assert.equal(assignments.length, 1, `${label}: the original base store occurs exactly once in checked source`);
  const target = assignments[0].Left;
  const observation = program.records.unobservedWrite.get(target);
  assert.equal(observation?.kind, "construction", `${label}: the existing family owns the actual layer disposition`);
  assert.equal(observation.layers.get(layer), expected, `${label}: actual later native reads determine the inherited store`);
  const field = plan.fields.find(selected => ast.text(ast.name(selected.declaration)) === "value");
  assert.equal(field !== undefined, true, `${label}: retain the inherited physical field`);
  assert.equal(plan.localFieldDeclarations.has(field.declaration), false,
    `${label}: no tuple-export read is invented for the deferred outer native binding`);
  const output = rustSourceText(result);
  assert.match(output, /field_value\s*=\s*String::from\("kept"\)/u,
    `${label}: the store and native String construction are never removed`);
});

for (const [label, declaration, body, after, expectedUnused, expectedCounted] of [
  ["native unused counter", "let index: int32 = 0", "total += 1;", "", true, true],
  ["number unused counter", "let index: number = 0", "total += 1;", "", true, true],
  ["body read", "let index: int32 = 0", "total += index;", "", false, true],
  ["captured counter", "let index: int32 = 0", "const read = (): int32 => index; total += read();", "", false, false],
  ["source var observed later", "var index: int32 = 0", "total += 1;", "total += index;", false, false],
]) test(`counted-loop liveness retains only emitted reads: ${label}`, () => {
  const source = `
import type { int32 } from "@tsonic/core/types.js";
export function inspect(count: int32): int32 {
  let total: int32 = 0;
  for (${declaration}; index < count; index++) { ${body} }
  ${after}
  return total;
}
`;
  const { program } = analyzeRust({ files: { "index.ts": source } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const loop = nodes.find(node => ast.is.IsForStatement(node));
  const counter = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "index");
  assert.equal(counter !== undefined && loop !== undefined, true, `${label}: retain the exact checked source binding and loop`);
  const counted = program.records.countedLoop.get(loop);
  assert.equal(counted !== undefined, expectedCounted, `${label}: use the existing counted-loop owner's actual selection`);
  if (counted !== undefined) assert.equal(counted.counterDeclaration === counter, true, `${label}: no other binding is erased`);
  const liveness = program.records.bindingLiveness.get(counter);
  assert.equal(liveness !== undefined, true, `${label}: liveness is complete before publication`);
  assert.equal(liveness.unused, expectedUnused, `${label}: captures, body reads and after-loop reads stay observable`);
  const count = nodes.find(node => ast.is.IsParameterDeclaration(node) && ast.text(ast.name(node)) === "count");
  assert.equal(program.records.bindingLiveness.get(count)?.unused, false, `${label}: the actual bound is still evaluated`);
  if (expectedUnused) {
    const { result } = compileRust({ files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0, `${label}: the same source is admitted for native emission`);
    const output = rustSourceText(result);
    assert.match(output, /for _ in /, `${label}: the unobserved counter needs no native binding`);
    assert.doesNotMatch(output, /let index\s*=/, `${label}: no unused float-counter conversion is emitted`);
    assert.match(output, /total/, `${label}: the loop body and its writes remain`);
  }
});

for (const surfaces of [[], ["js"]]) {
  for (const [label, condition, body, unused] of [
    ["erased guard only", 'typeof value === "string"', "total++;", true],
    ["observed element", 'typeof value === "string"', 'if (value === "seen") total++;', false],
    ["effectful element", 'typeof observe(value, effects) === "string"', "total++;", false],
  ]) test(`native iteration preserves the actual binding drop scope: ${label} (${surfaces[0] ?? "native"})`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
class Effects { calls = 0; }
function observe(value: string, effects: Effects): string { effects.calls++; return value; }
export function inspect(values: readonly string[], effects: Effects): number {
  let total = 0;
  for (const value of values) { if (${condition}) { ${body} } }
  return total;
}
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("; "));
    const program = result.program;
    const ast = program.source.ast;
    const nodes = [];
    const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
    program.sourceFiles.forEach(visit);
    const declaration = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "value");
    const loop = nodes.find(node => ast.is.IsForOfStatement(node));
    const binding = program.records.iterationCompletion.get(loop)?.binding;
    assert.equal(binding?.kind === "declaration" && binding.declaration === declaration, true,
      "the renderer consumes the identical completed iteration declaration");
    assert.equal(program.records.bindingLiveness.get(declaration)?.unused, unused,
      "only a genuinely erased native use leaves the element unobserved");
    const output = rustSourceText(result);
    assert.match(output, /for value in /u, "the authored binding and its per-iteration drop scope remain");
    assert.equal(/#\[expect\(unused_variables, reason = "authored binding drop scope"\)\]\s*for value in /u.test(output), unused,
      "the existing exact native liveness expectation follows the completed binding disposition");
    if (label === "observed element") {
      const comparison = nodes.find(node => ast.is.IsBinaryExpression(node) &&
        ast.is.IsIdentifier(ast.as.AsBinaryExpression(node).Left) &&
        ast.text(ast.as.AsBinaryExpression(node).Left) === "value");
      const reference = comparison === undefined ? undefined : ast.as.AsBinaryExpression(comparison).Left;
      assert.equal(reference !== undefined && program.records.readOwnership.get(reference) !== undefined, true,
        "the selected branch requires its completed native element read");
      assert.equal(output.includes('"seen"'), true, "the actual element comparison remains in the native body");
    }
    if (label === "effectful element") assert.equal(output.match(/\bobserve\(/gu)?.length, 2,
      "the one authored definition and one effectful operand invocation both remain");
  });
}

for (const [label, body, mutable, written] of [
  ["discarded direct write", "(() => owned++); return owned;", false, true],
  ["discarded mutable borrow", "(() => mut(owned)); return owned;", false, false],
  ["live direct write", "owned += 1; return owned;", true, true],
  ["live mutable borrow", "change(mut(owned)); return owned;", true, false],
]) test(`native lexical mutability follows emitted uses: ${label}`, () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
import { mut, load, store } from "@tsonic/rust/lang.js";
import type { Mut } from "@tsonic/rust/types.js";
function change(target: Mut<number>): void { store(target, load(target) + 1); }
export function inspect(input: number): number { let owned = input; ${body} }
` } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const declaration = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "owned");
  assert.equal(declaration !== undefined, true, `${label}: use the actual checked local declaration`);
  assert.equal(createTargetSourceProgram(source).navigation.declarationUseSummary(declaration).bindingWritten, written,
    `${label}: source assignments remain whole and native reference calls remain distinct`);
  const selected = program.records.localBinding.get(declaration);
  assert.equal(selected?.kind, "value", `${label}: the native local binding is selected before publication`);
  assert.equal(selected.mutable, mutable, `${label}: only an actual emitted native write or mutable borrow requires mut`);
  if (label === "live mutable borrow") {
    const expression = nodes.find(node => ast.is.IsCallExpression(node) && ast.is.IsIdentifier(ast.as.AsCallExpression(node).Expression) &&
      ast.text(ast.as.AsCallExpression(node).Expression) === "mut");
    const argument = expression === undefined ? undefined : ast.arguments(expression)[0];
    const read = program.records.readOwnership.get(argument);
    assert.equal(read?.source.kind === "borrow" && read.source.mutable, true,
      "a native mutable reference has a real selected ownership obligation even without source assignment syntax");
  } else if (!mutable) {
    const definition = nodes.find(node => ast.is.IsArrowFunction(node));
    assert.equal(program.records.nativeParticipation.get(definition), "erased",
      `${label}: the single source-body owner actually erases this uninvoked definition`);
  }
});
