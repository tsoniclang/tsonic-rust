import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { rustFlowReadProjectionFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { nativeRetainedErrorFlowSource } from "../../../../tsonic/test/fixtures/native-retained-errors.mjs";

test("retained-provider catch reads select exact readonly Error flow and observation facts without mutable origins", async () => {
  const { program } = analyzeRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    files: { "index.ts": nativeRetainedErrorFlowSource } });
  assert.deepEqual(program.projectTypes.sourceErrorCarrier(), rustJsErrorTargetType());
  assert.equal(program.projectTypes.sourceErrorDefinitions.length, 0);
  assert.equal(program.projectTypes.sourceCreatedErrorOrigins.length, 0);
  assert.equal(program.errorStorageDemands.retainedBoundaries.length > 0, true);
  const { ast } = program.source;
  const projections = [];
  const properties = [];
  const equalities = [];
  const visit = node => {
    const projection = program.facts.getFact(node, rustFlowReadProjectionFactKey);
    if (ast.is.IsIdentifier(node) && ast.text(node) === "failure" && projection !== undefined) projections.push(projection);
    const operation = program.facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "builtin-error-property" &&
      ast.text(Node_Expression(ast, node)) === "failure") properties.push(operation);
    if (operation?.kind === "program-error-equality") equalities.push(operation);
    for (const child of ast.children(node)) visit(child);
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(projections.length, 4);
  for (const projection of projections) {
    assert.deepEqual(projection, { kind: "builtin-error", sourceCarrier: rustProgramErrorTargetType(),
      selectedCarrier: rustSourceErrorTargetType() });
  }
  assert.deepEqual(properties.map(operation => operation.property).sort(), ["message", "name", "stack"]);
  for (const property of properties) assert.deepEqual(property.receiverCarrier, rustSourceErrorTargetType());
  assert.equal(equalities.length, 1);
  assert.equal(equalities[0].comparison.kind, "builtin");
  assert.deepEqual(equalities[0].sourceCarrier, rustSourceErrorTargetType());
  assert.deepEqual(equalities[0].targetCarrier, rustJsErrorTargetType());
});

test("retained-provider readonly Error identity and member observations lower through the existing exact projection", async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    files: { "index.ts": nativeRetainedErrorFlowSource } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 6).map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
  assert.equal(result.artifacts.some(artifact => artifact.path.endsWith("/index.rs")), true);
});
