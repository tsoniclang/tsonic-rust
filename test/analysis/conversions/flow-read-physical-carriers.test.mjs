import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSourceOptionalElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";

function returnedValues(program) {
  const { ast } = program.source;
  const selected = [];
  const visit = node => {
    if (ast.is.IsReturnStatement(node)) {
      const expression = ast.as.AsReturnStatement(node).Expression;
      if (expression !== undefined && ast.is.IsIdentifier(expression) && ast.text(expression) === "value") selected.push(expression);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return selected;
}

test("checked removal of source absence retains the admitted native payload instead of resolving a replacement type", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function read(value: string | undefined): string {
  if (value === undefined) return "absent";
  return value;
}
` } });
  const values = returnedValues(program);
  assert.equal(values.length, 1, "the actual checked present-value return is retained");
  const node = values[0];
  const source = program.records.runtimeCarrier.get(node)?.carrier;
  const payload = rustSourceOptionalElementCarrier(source);
  const projection = program.records.flowReadProjection.get(node);
  assert.equal(payload !== undefined, true, "the original source carrier has one admitted absence payload");
  assert.equal(projection?.kind, "option-value", "the existing native optional projection owns the narrowing");
  assert.equal(rustTargetTypeRefEquals(projection.sourceCarrier, source), true, "the complete actual source carrier is unchanged");
  assert.equal(rustTargetTypeRefEquals(projection.selectedCarrier, payload), true, "the selected payload is the original native payload");
});

test("generic source absence keeps its own physical payload and leaves the absent return optional", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function retain<T>(value: T | undefined): T | undefined {
  if (value === undefined) return value;
  return value;
}
` } });
  const values = returnedValues(program);
  assert.equal(values.length, 2, "both original present and absent returns remain checked");
  const absent = values[0];
  const present = values[1];
  const source = program.records.runtimeCarrier.get(present)?.carrier;
  const payload = rustSourceOptionalElementCarrier(source);
  const projection = program.records.flowReadProjection.get(present);
  assert.equal(payload !== undefined, true, "the actual generic source optional has a native payload");
  assert.equal(rustTargetTypeRefEquals(projection?.selectedCarrier, payload), true, "generic payload identity is not reconstructed from a name");
  assert.equal(rustSourceOptionalElementCarrier(program.records.runtimeCarrier.get(absent)?.carrier) !== undefined, true,
    "the native absence branch retains its original optional carrier");
  assert.equal(program.records.flowReadProjection.get(absent) === undefined, true,
    "an absent value is not spuriously projected to a present generic value");
});

test("a further checked union refinement is not replaced by the entire present optional payload", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function read(value: string | number | undefined): string {
  if (typeof value === "string") return value;
  return "other";
}
` } });
  const values = returnedValues(program);
  assert.equal(values.length, 1, "the string-only guard retains the original checked read");
  const node = values[0];
  const source = program.records.runtimeCarrier.get(node)?.carrier;
  const payload = rustSourceOptionalElementCarrier(source);
  const projection = program.records.flowReadProjection.get(node);
  assert.equal(payload !== undefined, true, "the original value is genuinely optional");
  assert.equal(projection !== undefined, true, "the exact surviving union arm has its own native projection");
  assert.equal(rustTargetTypeRefEquals(projection.selectedCarrier, payload), false,
    "a string-only refinement must not retain the entire number-or-string payload");
  assert.equal(rustTargetTypeRefEquals(projection.sourceCarrier, source), true,
    "further narrowing still starts from the identical admitted physical source");
});

test("an unknown optional input stays closed and is not invented into a more specific native value", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function retain(value: unknown): unknown {
  if (value === undefined) return value;
  return value;
}
` } });
  const values = returnedValues(program);
  assert.equal(values.length, 2, "both unknown source branches preserve their actual source reads");
  for (const node of values) {
    const source = program.records.runtimeCarrier.get(node)?.carrier;
    const projection = program.records.flowReadProjection.get(node);
    assert.equal(source !== undefined, true, "a checked unknown input still has its exact closed native carrier");
    assert.equal(projection === undefined || rustTargetTypeRefEquals(projection.sourceCarrier, source), true,
      "no projection may manufacture a different native source carrier");
    assert.equal(projection === undefined || rustSourceOptionalElementCarrier(source) !== undefined ||
      projection.kind !== "option-value", true, "a non-optional closed input is not treated as native Option payload storage");
  }
});

test("a checked optional callable guard selects its original physical union arm before invocation", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function inspect(value: string | (() => string) | undefined): void {
  if (typeof value === "function") value();
}
` } });
  const { ast } = program.source;
  let observations = 0;
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const callee = ast.as.AsCallExpression(node).Expression;
      if (ast.is.IsIdentifier(callee) && ast.text(callee) === "value") {
        const source = program.records.runtimeCarrier.get(callee)?.carrier;
        const projection = program.records.flowReadProjection.get(callee);
        const payload = rustSourceOptionalElementCarrier(source);
        const leaf = payload === undefined ? undefined : rustUnionLeaves(payload, program.typeDefinitions)?.find(member =>
          member.path[member.path.length - 1]?.variant.name === projection?.variant);
        assert.equal(projection?.kind, "source-union", "actual checked typeof selection publishes the existing native union projection");
        assert.equal(rustTargetTypeRefEquals(projection.sourceCarrier, source), true,
          "the actual optional source identity remains the projection source");
        assert.equal(leaf !== undefined && rustTargetTypeRefEquals(leaf.carrier, projection.selectedCarrier), true,
          "the selected callable is the exact native union arm, including its retained lifetime");
        assert.equal(program.records.targetOperation.get(node) !== undefined, true,
          "the original call is admitted from the completed physical arm");
        observations++;
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(observations, 1, "the actual guarded invocation is checked once");
});
