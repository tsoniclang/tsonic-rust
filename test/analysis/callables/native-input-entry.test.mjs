import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { nativeRetainedErrorSourceFor } from "../../../../tsonic/test/fixtures/native-retained-errors.mjs";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustRetainedErrorTargetType, rustSourceErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";

test("every authored formal including unused and default inputs consumes its exact early entry carrier", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    export function select(unused: () => int32, value: int32, fallback: int32 = 9): int32 { return value; }
  ` } });
  let declaration;
  const visit = node => {
    if (program.source.ast.is.IsFunctionDeclaration(node) && program.records.sourceName.get(node) === "select") declaration = node;
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(declaration !== undefined, true, "the original native declaration is present");
  const parameters = program.source.ast.parameters(declaration);
  const entry = program.records.callableLeading.get(declaration);
  assert.equal(parameters.length, 3, "unused, ordinary and default source inputs remain in authored order");
  assert.equal(entry?.sourceParameters.size, parameters.length, "the early physical inventory includes every incoming formal");
  assert.equal(Object.isFrozen(entry.sourceParameters) && entry.sourceParameters.set === undefined && entry.sourceParameters.clear === undefined,
    true, "the published formal inventory has no mutation route after the seal");
  for (const parameter of parameters) {
    const selected = entry.sourceParameters.get(parameter);
    const emitted = program.records.callableParameter.get(parameter);
    assert.equal(selected !== undefined && emitted !== undefined, true, "the original parameter owns both publication stages");
    assert.equal(emitted.carrier === selected, true, "later default and body initialization do not reselect the native input carrier");
    assert.equal(program.records.sourceParameterAbi.get(parameter) !== undefined, true, "each selected formal retains its original ABI evidence");
  }
});

for (const [parameterForm, storage, ordering] of [
  ["aliased", "record", "direct"],
  ["annotated", "record", "captured"],
  ["aliased", "binding", "captured"],
]) {
  test(`annotated native callback inputs retain exact physical and logical entry carriers (${parameterForm}, ${storage}, ${ordering})`, { timeout: 300_000 }, async () => {
    const { program } = analyzeRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
      files: { "index.ts": nativeRetainedErrorSourceFor(parameterForm, storage, ordering) } });
    let parameter;
    let listener;
    const visit = node => {
      if (program.source.ast.is.IsArrowFunction(node) && program.source.ast.parameters(node).length === 1) {
        assert.equal(parameter === undefined, true, "fixture has exactly one authored callback");
        parameter = program.source.ast.parameters(node)[0];
      }
      if (program.source.ast.is.IsVariableDeclaration(node) &&
        program.source.ast.text(program.source.ast.name(node)) === "listener") listener = node;
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(parameter !== undefined, true, "callback parameter exists");
    const abi = program.records.sourceParameterAbi.get(parameter);
    assert.equal(abi !== undefined, true, "native parameter ABI is finalized");
    assert.equal(abi.form, "required");
    assert.equal(abi.mode, "value");
    assert.equal(rustTargetTypeRefEquals(abi.parameterCarrier, rustRetainedErrorTargetType()), true);
    assert.equal(rustTargetTypeRefEquals(abi.valueCarrier, rustSourceErrorTargetType()), true);
    const contract = abi.entryConversion?.contract;
    assert.equal(contract !== undefined, true, "entry conversion has an exact public contract");
    assert.equal(contract.category, "exact");
    assert.equal(contract.sourceMode, "value");
    assert.equal(contract.fallible, false);
    assert.equal(rustTargetTypeRefEquals(contract.source, abi.parameterCarrier), true);
    assert.equal(rustTargetTypeRefEquals(contract.target, abi.valueCarrier), true);
    assert.equal(selectRustSourceValueConversion(abi.parameterCarrier,
      rustWritableSourceErrorTargetType(), program.typeDefinitions), undefined,
    "readonly native admission cannot fabricate writable authority");
    if (ordering === "captured") {
      assert.equal(listener !== undefined, true, "captured callback has its exact binding declaration");
      const protocol = rustCallableProtocol(program.records.runtimeCarrier.get(listener)?.carrier);
      assert.equal(protocol !== undefined, true, "binding consumes its finalized physical callback ABI");
      assert.equal(protocol.parameters.length, 1);
      assert.equal(rustTargetTypeRefEquals(protocol.parameters[0], abi.parameterCarrier), true,
        "semantic body input does not replace the retained native entry carrier");
    }
  });
}
