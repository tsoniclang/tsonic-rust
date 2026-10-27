import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";
import { analyzeRustObjectLiteralEmission } from "../../../dist/analysis/objects/object-literal-emission.js";
import { createRustObjectLiteralEmissionProducer } from "../../../dist/analysis/program/records/objects/object-literal-emission.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function analyze(body) {
  let program;
  let source;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": body }, compileTarget(request) {
    source = request.input.source;
    const analyzed = analyzeRustAnalysisProgram(request);
    if (analyzed.kind === "rejected") return analyzed;
    program = analyzed.value;
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(program !== undefined, true, "the real object-literal producer admits the source");
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  const literal = text => nodes.find(node => {
    const ast = program.source.ast;
    if (!ast.is.IsObjectLiteralExpression(node)) return false;
    const range = ast.authoredRange(node);
    const file = ast.getSourceFile(node);
    return range.kind === "authored" && file !== undefined && ast.getSourceText(file).slice(range.start, range.end) === text;
  });
  const fields = node => {
    const emission = program.records.objectLiteralEmission.get(node);
    const fact = program.records.targetOperation.get(node);
    assert.equal(emission !== undefined && fact?.kind === "record-literal", true,
      "the authored literal has one canonical physical emission record");
    return emission.sourceFields.map(field => ({ ...field,
      name: fact.fields.find(selected => selected.storageIndex === field.storageIndex)?.sourceName }));
  };
  return { program, source, nodes, literal, fields };
}

test("nested literal values keep their own insertion order and exact source occurrence", () => {
  const current = analyze("export function encode(): string | undefined { return JSON.stringify({ b: { a: 1, b: 2 }, a: 0 }); }");
  const outer = current.literal("{ b: { a: 1, b: 2 }, a: 0 }");
  const inner = current.literal("{ a: 1, b: 2 }");
  const outerFields = current.fields(outer);
  assert.equal(outerFields.map(field => field.name).join(","), "b,a", "outer order is authored, not alphabetical");
  assert.equal(current.fields(inner).map(field => field.name).join(","), "a,b", "inner order is independent of the outer order");
  assert.equal(outerFields[0].value === inner, true, "the nested conversion receives the inner literal, never its parent");
});

test("literal spreads retain the first position and the latest overriding value", () => {
  const current = analyze(`export function encode(): string | undefined {
  return JSON.stringify({ ...{ b: { a: 1, b: 2 }, a: 0 }, b: { b: 3, a: 4 }, c: 1 });
}`);
  const outer = current.literal("{ ...{ b: { a: 1, b: 2 }, a: 0 }, b: { b: 3, a: 4 }, c: 1 }");
  const latest = current.literal("{ b: 3, a: 4 }");
  const fields = current.fields(outer);
  assert.equal(fields.map(field => field.name).join(","), "b,a,c", "overwriting a spread key does not move its first insertion");
  assert.equal(fields[0].value === latest, true, "the field's nested value comes from the latest exact contribution");
  assert.equal(current.fields(latest).map(field => field.name).join(","), "b,a", "the latest nested value owns its own ordered fields");
});

test("a nonliteral spread never claims a forged nested value origin", () => {
  const current = analyze(`export function encode(source: { b: { b: number; a: number }; a: number }): string | undefined {
  return JSON.stringify({ ...source, c: 1 });
}`);
  const fields = current.fields(current.literal("{ ...source, c: 1 }"));
  assert.equal(fields.filter(field => field.name !== "c").every(field => field.value === undefined), true,
    "unknown stored field origins remain explicit, not copied from the outer literal");
  assert.equal(fields.find(field => field.name === "c")?.value !== undefined, true,
    "the authored field still retains its exact native value occurrence");
});

test("project object literal records carry the same physical field correspondence", () => {
  const current = analyze(`interface Data { readonly a: number; readonly b: number }
export function create(): Data { return { b: 1, a: 2 }; }`);
  const node = current.literal("{ b: 1, a: 2 }");
  const selected = current.program.records.objectLiteralEmission.get(node);
  assert.equal(selected !== undefined, true, "the original source interface literal publishes its exact physical evidence");
  assert.equal(rustTargetTypeRefEquals(selected.carrier, current.program.records.targetOperation.get(node).resultCarrier), true,
    "direct construction retains the original selected native carrier");
  assert.equal(selected.implementation === undefined, true, "data-only native construction does not invent a dispatch implementation");
  assert.equal(current.fields(node).map(field => field.name).join(","), "b,a",
    "project and structural forms use the same source order and exact physical field indexes");
});

test("an unrelated checked object occurrence cannot publish literal source fields", () => {
  const current = analyze("export function create(): { b: number; a: number } { return { b: 1, a: 2 }; }");
  const node = current.literal("{ b: 1, a: 2 }");
  const producer = createRustObjectLiteralEmissionProducer(() => {});
  assert.throws(() => analyzeRustObjectLiteralEmission(current.program, [node], producer, () => undefined,
    property => ({ element: property, objectLiteral: current.program.sourceFiles[0], elementKind: "property" }), current.source),
  /exact checked source occurrence/u, "a forged parent is an internal producer violation, not valid nested projection evidence");
  assert.equal(producer.records.objectLiteralEmission.get(node) === undefined, true,
    "rejected source correspondence publishes no literal implementation");
});
