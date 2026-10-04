import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { nativeRetainedErrorSourceFor } from "../../../../tsonic/test/fixtures/native-retained-errors.mjs";
import { rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustRetainedErrorTargetType, rustSourceErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";

test("annotated native callback inputs retain exact physical and logical entry carriers", { timeout: 300_000 }, async () => {
  const { program } = analyzeRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    files: { "index.ts": nativeRetainedErrorSourceFor("aliased", "record") } });
  let parameter;
  const visit = node => {
    if (program.source.ast.is.IsArrowFunction(node)) {
      assert.equal(parameter === undefined, true, "fixture has exactly one authored callback");
      parameter = program.source.ast.parameters(node)[0];
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(parameter !== undefined, true, "callback parameter exists");
  const abi = program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
  assert.equal(abi !== undefined, true, "native parameter ABI is finalized");
  assert.equal(abi.form, "required");
  assert.equal(abi.mode, "value");
  assert.equal(rustTargetTypeRefEquals(abi.parameterCarrier, rustRetainedErrorTargetType()), true);
  assert.equal(rustTargetTypeRefEquals(abi.valueCarrier, rustSourceErrorTargetType()), true);
  const contract = rustValueConversionContract(abi.entryConversion, program.typeDefinitions);
  assert.equal(contract !== undefined, true, "entry conversion has an exact public contract");
  assert.equal(contract.category, "exact");
  assert.equal(contract.sourceMode, "value");
  assert.equal(contract.fallible, false);
  assert.equal(rustTargetTypeRefEquals(contract.source, abi.parameterCarrier), true);
  assert.equal(rustTargetTypeRefEquals(contract.target, abi.valueCarrier), true);
  assert.equal(selectRustSourceValueConversion(abi.parameterCarrier,
    rustWritableSourceErrorTargetType(), program.typeDefinitions), undefined,
  "readonly native admission cannot fabricate writable authority");
});
