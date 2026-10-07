import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { selectRustNativeFlowMembers } from "../../../dist/policy/types/resolution/native-flow-refinement.js";
import { rustJsArrayTargetType, rustJsErrorTargetType, rustJsRegExpTargetType, rustJsValueTargetType, rustSourceUnionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { resolveRustInstanceType } from "../../../dist/policy/types/resolution/instance-tests.js";

test("subset-kind guards never exclude the complete shared native Error carrier", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { "/src/index.ts": `
    declare function observe(value: unknown): void;
    function run(value: Error | string): void {
      if (value instanceof RangeError) return;
      observe(value);
      if (value instanceof TypeError) observe(value);
    }
  ` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const reads = [];
  const visit = node => {
    const call = source.semantics.forNode(node).operations.call(node);
    if (source.ast.text(call?.sourceCallee.expression) === "observe") reads.push(call.sourceArguments[0].expression);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(checked.getSourceFile("/src/index.ts"));
  assert.equal(reads.length, 2);
  const context = { ast: source.ast, navigation: source.navigation, sourceFacts: source.sourceFacts,
    semanticsFor: node => source.semantics.forNode(node) };
  const carriers = [rustJsErrorTargetType(), rustStringTargetType()];
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Value");
  const definitions = { programErrorOrigin: () => undefined, sourceUnionVariants: selected => selected === carrier
    ? carriers.map((value, index) => ({ name: `Variant${index}`, carrier: value })) : undefined };
  const selectGuard = expression => {
    const binary = source.ast.as.AsBinaryExpression(expression);
    const name = source.ast.text(binary?.Right);
    return ["RangeError", "TypeError"].includes(name) ? {
      sourceOperand: binary.Left, predicate: { kind: "error", errorKind: name },
    } : undefined;
  };
  const selected = reads.map(reference => selectRustNativeFlowMembers(context, reference, carrier,
    { definitionForCarrier: () => undefined }, definitions, selectGuard,
    () => { assert.fail("exact native predicate must not collapse to nominal carrier equality"); })?.map(member => member.carrier));
  assert.deepEqual(selected, [carriers, [carriers[0]]]);
});

test("native nominal guard selection completes partial typeof evidence through the exact constructor owner", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { "/src/index.ts": `
declare class Pattern { test(text: string): boolean; }
declare function observe(value: unknown): void;
function run(value: string | Pattern | string[]): void {
  if (typeof value === "string") return;
  if (value instanceof Pattern) observe(value);
}
` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assertNoTargetDiagnostics(checked.diagnostics);
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/src/index.ts");
  const reads = [];
  const visit = node => {
    if (source.ast.is.IsCallExpression(node)) {
      const call = source.semantics.forNode(node).operations.call(node);
      if (source.ast.text(call?.sourceCallee.expression) === "observe") reads.push(call.sourceArguments[0].expression);
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  assert.equal(reads.length, 1);
  const context = { ast: source.ast, navigation: source.navigation, sourceFacts: source.sourceFacts,
    semanticsFor: node => source.semantics.forNode(node) };
  const string = rustStringTargetType();
  const regexp = rustJsRegExpTargetType();
  const array = rustJsArrayTargetType(string);
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Value");
  const definitions = { programErrorOrigin: () => undefined, sourceUnionVariants: type => type === carrier
    ? [string, regexp, array].map((selected, index) => ({ name: `Variant${index}`, carrier: selected })) : undefined };
  const projects = { definitionForCarrier: () => undefined };
  let queries = 0;
  const selected = selectRustNativeFlowMembers(context, reads[0], carrier, projects, definitions,
    () => undefined, guard => {
      queries++;
      assert.equal(source.navigation.sourceReferenceFor(guard.sourceConstructor)?.declaration, guard.declaration);
      return regexp;
    });
  assert.equal(queries, 1);
  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].carrier, regexp);
  const unknown = selectRustNativeFlowMembers(context, reads[0], carrier, projects, definitions,
    () => undefined, () => undefined);
  assert.equal(unknown.length, 2);
});

test("nominal constructor policy rejects unclassified native declarations and open project binders", () => {
  const declaration = {};
  const constructor = {};
  const context = { facts: { get: () => undefined }, source: { sourceFacts: { getFact: () => undefined } },
    ast: { kind: () => 1, getSourceFile: () => undefined } };
  const options = { projectTypes: { definitionForDeclaration: () => undefined },
    sourceProfiles: { profileForNode: () => undefined } };
  assert.equal(resolveRustInstanceType(declaration, constructor, context, options), undefined);
  const generic = { kind: "class", genericParameters: [{}] };
  assert.equal(resolveRustInstanceType(declaration, constructor, context, { ...options,
    projectTypes: { definitionForDeclaration: () => generic } }), undefined);
});

test("literal guards retain exact native integer widths and broad unknown payloads", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { "/src/index.ts": `
    declare function observe(value: unknown): void;
    function run(value: unknown): void {
      if (value === 1) observe(value);
      if (value === 1n) observe(value);
      if (value === "route") observe(value);
    }
  ` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assertNoTargetDiagnostics(checked.diagnostics);
  const source = createTargetSourceProgram(checked);
  const reads = [];
  const visit = node => {
    const call = source.semantics.forNode(node).operations.call(node);
    if (source.ast.text(call?.sourceCallee.expression) === "observe") reads.push(call.sourceArguments[0].expression);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(checked.getSourceFile("/src/index.ts"));
  assert.equal(reads.length, 3);
  const context = { ast: source.ast, navigation: source.navigation, sourceFacts: source.sourceFacts,
    semanticsFor: node => source.semantics.forNode(node) };
  const carriers = [{ kind: "source-primitive", name: "int32" }, { kind: "source-primitive", name: "int64" },
    rustJsValueTargetType(), rustStringTargetType()];
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Value");
  const definitions = { programErrorOrigin: () => undefined, sourceUnionVariants: selected => selected === carrier
    ? carriers.map((value, index) => ({ name: `Variant${index}`, carrier: value })) : undefined };
  const selected = reads.map(reference => selectRustNativeFlowMembers(context, reference, carrier,
    { definitionForCarrier: () => undefined }, definitions, () => undefined, () => undefined)?.map(member => member.carrier));
  assert.deepEqual(selected, [carriers.slice(0, 3), carriers.slice(0, 3), carriers.slice(2)]);
});
