import assert from "node:assert/strict";
import test from "node:test";
import { acmeLogsinkCapability, analyzeRust } from "../../helpers/rust-session.mjs";
import { rustBorrowedStrTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const [name, source, receiver, expected, mode, parameterMode, packages] of [
  ["semantic object-to-JsValue conversion", "export function render(value: { title: string }): string | undefined { return JSON.stringify(value); } console.log(render({title: 'x'}));", false, false, "ref", "value", []],
  ["unchanged borrowed string", "export function read(value: string): number { return value.indexOf('x'); } console.log(read('x'));", true, false, "value", "ref", []],
  ["native unchanged String reference", 'import { openSinkNamed } from "logsink"; export function read(value: string): void { openSinkNamed(value); }', false, true, "ref", "ref", [acmeLogsinkCapability()]],
]) {
  test(`provider reference ${name} keeps the selected converted value`, () => {
    const { program } = analyzeRust({ packages, surfaces: ["js"], files: { "index.ts": source } });
    const selected = program.physicalEmissionContexts.sourceOccurrences
      .filter(occurrence => receiver || expected ? occurrence.operation.abi.operationKind === "method"
        : occurrence.operation.operationId.startsWith("tsonic.rust.js.JSON.stringify."))
      .flatMap(occurrence => occurrence.inputs)
      .filter(({ input }) => receiver ? input.source.kind === "receiver"
        : input.source.kind === "argument" && input.source.sourceIndex === 0);
    assert.equal(selected.length, 1, "the exact checked provider source has one receiver or first argument input");
    const converted = selected.filter(({ input }) => input.conversion.kind !== "identity");
    assert.equal(converted.length > 0, !expected, "the control really distinguishes a semantic transition from identity");
    for (const { input, slot } of selected) {
      assert.equal(input.mode, mode, "the provider preserves its exact native reference or str-reference-value ABI");
      assert.equal(program.records.sourceParameterAbi.get(slot.node)?.mode, parameterMode,
        "readonly String has a native reference ABI; structural JSON storage remains an owned source value");
      if (receiver) {
        assert.equal(input.conversion.kind === "semantic" && input.conversion.conversion.kind === "semantic-conversion" &&
          input.conversion.conversion.id === "borrowed-str-from-owned-string", true,
        "the original JS String receiver keeps its actual provider-selected str conversion");
        assert.equal(input.sharedConversion, true, "that exact conversion borrows rather than clones its String source");
        assert.equal(rustTargetTypeRefEquals(input.sourceCarrier, rustStringTargetType()) &&
          rustTargetTypeRefEquals(input.parameterCarrier, rustBorrowedStrTargetType()), true,
        "the converted str parameter is not falsely classified as the original String reference");
      }
    }
    for (const { input, slot } of expected ? selected : converted) {
      assert.equal(program.records.providerReference.get(slot.node, input), expected,
        "only an unchanged value can reuse the parameter's existing reference");
    }
  });
}
