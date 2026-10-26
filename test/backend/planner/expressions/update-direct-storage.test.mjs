import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { planRustDirectStorageCore } from "../../../../dist/backend/planner/expressions/update-direct-storage.js";
import { analyzeRustDirectStorage } from "../../../../dist/analysis/storage/direct-storage.js";
import { createRustDirectStorageProducer } from "../../../../dist/analysis/program/records/direct-storage.js";
import { analyzeRust, compileRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { BinaryExpression_Left, Node_Expression } from "@tsonic/target-api/source";
import { planRustUnionProjection } from "../../../../dist/backend/planner/expressions/union-mappings.js";
import { isRustCopyCarrier } from "../../../../dist/policy/constraints/native-traits.js";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";

const programs = new Map();

test("direct native union places retain the selected payload and exact mutable use", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function update(body: boolean | unknown[]): void {
  if (typeof body === "boolean") return;
  body[0] = 2;
}
` } });
  const ast = program.source.ast;
  let assignment;
  const visit = node => {
    if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindEqualsToken") assignment = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(assignment !== undefined, true, "the original closed-union indexed write is checked");
  const target = BinaryExpression_Left(ast, assignment);
  const receiver = Node_Expression(ast, target);
  const place = program.records.directStorage.get(target);
  const receiverPlace = program.records.directStorage.get(receiver);
  const flow = program.records.flowReadProjection.get(receiver);
  const emission = program.records.flowReadEmission.get(flow);
  assert.equal(place?.kind === "provider" && emission?.kind === "union", true,
    "the existing native place and closed-union owners select this exact receiver");
  assert.equal(receiverPlace?.kind !== "unavailable" && receiverPlace?.projection?.emission === emission.projection, true,
    "the place transports the same admitted arm and payload correspondence");
  assert.equal(receiverPlace.projection.access, "mutable", "the checked write keeps its actual mutable source use");
  assert.equal(Object.isFrozen(receiverPlace.projection), true, "the native projection selection is finalized before rendering");
});

function fixture(storage, module = false) {
  if (!programs.has(module)) programs.set(module, analyzeRust({ files: { "index.ts": module
    ? 'export let value = "value"; export function selected(): string { return (value); }'
    : 'export function selected(): string { const value = "value"; return (value); }' } }).program);
  const program = programs.get(module);
  const { ast } = program.source;
  let parenthesized;
  const visit = node => {
    if (ast.is.IsParenthesizedExpression(node)) parenthesized = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(parenthesized !== undefined, true, "the storage fixture uses its actual checked parenthesized read");
  const node = ast.as.AsParenthesizedExpression(parenthesized).Expression;
  const binding = program.records.sourceBinding.get(node);
  assert.equal(binding !== undefined, true, "the direct-storage producer consumes the real checked binding identity");
  const declaration = binding.sourceDeclaration;
  const carrier = program.records.valueRead.get(node).source;
  const family = module ? "moduleBinding" : "bindingStorage";
  const records = createRustRecordFixture({ [family]: { get: selected => selected === declaration
    ? storage === undefined ? undefined : { ...program.records[family].get(declaration), storage, valueCarrier: carrier }
    : program.records[family].get(selected) } }, program.records);
  const producer = createRustDirectStorageProducer(() => {});
  const issues = analyzeRustDirectStorage({ ...program, records }, [node, parenthesized], producer,
    { typedLocationPlan: { get: () => undefined } });
  assert.equal(issues.length, 0, "the actual pre-seal native place owner admits the selected binding representation");
  const context = rustSourceFilePlanContext({ ...program,
    records: createRustRecordFixture(producer.records, records) }, node);
  return { node, parenthesized, declaration, carrier, context };
}

function selected(node, context) {
  return planRustDirectStorageCore(node, context, undefined,
    () => assert.fail("direct binding selection must not replan a value"),
    () => assert.fail("direct binding selection must not invent a provider call"));
}

test("direct storage consumes finalized lexical and module binding representation", () => {
  for (const storage of ["location", "cell", "borrow-cell"]) {
    const { node, parenthesized, context } = fixture(storage);
    assert.equal(selected(node, context) === undefined, true, storage);
    assert.equal(selected(parenthesized, context) === undefined, true, storage + " parenthesized");
  }
  const { node, context } = fixture("module-cell", true);
  assert.equal(selected(node, context) === undefined, true, "module storage is not a native value place");
  const direct = fixture();
  assert.deepEqual(selected(direct.node, direct.context), { kind: "path", path: "value" });
});

test("direct storage preserves exact lexical value overrides and selected capture storage", () => {
  const { node, carrier, context } = fixture("location");
  const expression = { kind: "path", path: "selected_value" };
  assert.equal(selected(node, { ...context, expressionOverrides: new Map([[node, {
    expression, carrier, valueForm: "storage", storageForm: "plain",
  }]]) }) === expression, true, "a lexical storage override owns its physical expression");
  for (const valueForm of ["owned", "shared-reference"]) {
    assert.equal(selected(node, { ...context, expressionOverrides: new Map([[node, {
      expression, carrier, valueForm,
    }]]) }) === undefined, true, valueForm);
  }
  const captured = fixture();
  for (const storage of ["value", "location", "cell", "borrow-cell"]) {
    const capture = { declaration: captured.declaration, expression, valueCarrier: captured.carrier, storage };
    const result = selected(captured.node, { ...captured.context, capturedBindings: [capture] });
    assert.equal(result === expression, storage === "value", "the selected capture owns " + storage);
  }
});

const projectedPrograms = new Map();
const projectedCases = [
  ["written native vector", `
type Body = boolean | unknown[];
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  value[0] = 2;
  return value[0] === 2;
}`, ["mutable", "shared"]],
  ["parenthesized native vector", `
type Body = boolean | unknown[];
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  (value)[0] = 2;
  return (value)[0] === 2;
}`, ["mutable", "shared"]],
  ["written native Copy array", `
import type { FixedArray, int32 } from "@tsonic/core/types.js";
type Body = boolean | FixedArray<int32, 2>;
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  value[0] = 2;
  return value[0] === 2;
}`, ["mutable", "shared"]],
  ["shared object interior", `
class Box { count: number = 0; }
type Body = boolean | Box;
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  const alias = value;
  value.count = 2;
  return alias.count === 2;
}`, ["shared"]],
  ["untouched native vector", `
type Body = boolean | unknown[];
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  return value[0] === 2;
}`, ["shared"]],
];

function projectedFixture(label, source) {
  if (!projectedPrograms.has(label)) projectedPrograms.set(label, analyzeRust({ files: { "index.ts": source } }).program);
  const program = projectedPrograms.get(label);
  const { ast } = program.source;
  const receivers = [];
  const visit = node => {
    const parent = ast.parent(node);
    const receiver = parent === undefined ? undefined : ast.is.IsElementAccessExpression(parent)
      ? ast.as.AsElementAccessExpression(parent).Expression : ast.is.IsPropertyAccessExpression(parent)
        ? ast.as.AsPropertyAccessExpression(parent).Expression : undefined;
    const subject = ast.is.IsParenthesizedExpression(node) ? ast.as.AsParenthesizedExpression(node).Expression : node;
    if (ast.is.IsIdentifier(subject) && ast.text(subject) === "value" && receiver === node) receivers.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return { program, receivers };
}

for (const [label, source, accessModes] of projectedCases) {
  test(`direct native union places consume the actual per-use access: ${label}`, () => {
    const { program, receivers } = projectedFixture(label, source);
    assert.equal(receivers.length, accessModes.length, `${label}: every original selected receiver is retained`);
    for (const [index, node] of receivers.entries()) {
      const access = accessModes[index];
      assert.equal(program.ownership.uses.get(node)?.mode, access, `${label}: the one native-use producer decides this exact use`);
      let placeNode = node;
      let place = program.records.directStorage.get(placeNode);
      while (place?.kind === "parenthesized" && place.projection === undefined) {
        placeNode = place.inner;
        place = program.records.directStorage.get(placeNode);
      }
      const flow = program.records.flowReadProjection.get(placeNode);
      assert.equal(flow !== undefined, true, `${label}: use the actual checked flow correspondence`);
      const emission = program.records.flowReadEmission.get(flow);
      assert.equal(emission?.kind, "union", `${label}: native projection is completed before direct-place selection`);
      assert.equal(place?.kind, "identifier", `${label}: the selected native payload remains a place`);
      assert.equal(place.projection?.emission === emission.projection, true, `${label}: no second native projection is selected`);
      assert.equal(place.projection.access, access, `${label}: parameter-wide mutability cannot replace point-of-use access`);
      assert.equal(Object.isFrozen(place.projection), true, `${label}: the native place access is immutable`);
      const expression = selected(node, rustSourceFilePlanContext(program, node));
      assert.equal(expression?.kind, "dereference", `${label}: use the selected payload storage without copying it`);
      assert.equal(expression.pointer.kind, "match", `${label}: reuse the canonical finite native union recipe`);
      assert.equal(expression.pointer.expression.kind, "reference", `${label}: the original enum is borrowed, not moved`);
      assert.equal(expression.pointer.expression.mutable === true, access === "mutable", `${label}: borrow exactly the admitted native mode`);
      assert.equal(expression.pointer.arms[0].expression.kind, "path", `${label}: no payload Clone, allocation or re-evaluation`);
      if (label === "written native Copy array") {
        assert.equal(isRustCopyCarrier(emission.projection.carrier), true, "actual native Copy capability cannot select or erase writable access");
      }
    }
  });
}

test("native union place publication retains exact absence, access, seal and duplicate guards", () => {
  const [label, source] = projectedCases[0];
  const { program, receivers: [node] } = projectedFixture(label, source);
  for (const mode of [undefined, "value", "move"]) {
    const uses = new Map(program.ownership.uses);
    if (mode === undefined) uses.delete(node);
    else uses.set(node, { ...uses.get(node), mode });
    const producer = createRustDirectStorageProducer(() => {});
    const issues = analyzeRustDirectStorage({ ...program, ownership: { ...program.ownership, uses } }, [node], producer,
      { typedLocationPlan: { get: () => undefined } });
    assert.equal(issues.length, 0, "not selecting a borrowed payload place does not invent a source rejection");
    assert.equal(producer.records.directStorage.get(node)?.kind, "unavailable", `${mode ?? "absent"}: no guessed native borrow mode`);
  }
  assert.throws(() => analyzeRustDirectStorage({ ...program,
    records: createRustRecordFixture({ flowReadEmission: { get: () => undefined } }, program.records) },
  [node], createRustDirectStorageProducer(() => {}), { typedLocationPlan: { get: () => undefined } }),
  /A native union place requires its completed flow projection/u);
  const place = program.records.directStorage.get(node);
  let open = true;
  const producer = createRustDirectStorageProducer(() => assert.equal(open, true, "the original native place producer is sealed"));
  producer.place(node, place);
  assert.throws(() => producer.place(node, place), /Duplicate Rust semantic plan/u);
  open = false;
  assert.throws(() => producer.place(node, place), /the original native place producer is sealed/u);
  const emission = place.projection.emission;
  const context = rustSourceFilePlanContext(program, node);
  assert.throws(() => planRustUnionProjection(node, { kind: "path", path: "value" },
    { ...emission, targetOptional: true }, "mutable-reference", context), /exact type, presence and read contract/u);
  assert.throws(() => planRustUnionProjection(node, { kind: "path", path: "value" },
    { ...emission, variant: { ...emission.variant, kind: "constant", value: true } }, "mutable-reference", context),
  /exact type, presence and read contract/u);
});

test("native whole-union rebinding remains distinct from a narrowed payload write", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
type Body = boolean | unknown[];
function replace(value: Body): Body {
  if (typeof value === "boolean") value = [1];
  else value = true;
  return value;
}
export function main(): void {
  const vector = replace(true);
  if (typeof vector === "boolean" || vector[0] !== 1) throw new Error("native vector replacement changed");
  const flag = replace([2]);
  if (typeof flag !== "boolean" || flag !== true) throw new Error("native whole-union replacement changed");
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("native-union-place-rebinding", result.artifacts, { run: true });
});
