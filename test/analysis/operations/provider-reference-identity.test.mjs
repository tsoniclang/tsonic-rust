import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const [name, source, expected] of [
  ["semantic object-to-JsValue conversion", "export function render(value: { title: string }): string | undefined { return JSON.stringify(value); } console.log(render({title: 'x'}));", false],
  ["unchanged borrowed string", "export function read(value: string): number { return value.indexOf('x'); } console.log(read('x'));", true],
]) {
  test(`provider reference ${name} keeps the selected converted value`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
    const selected = program.physicalEmissionContexts.sourceOccurrences
      .filter(occurrence => expected ? occurrence.operation.abi.operationKind === "method"
        : occurrence.operation.operationId.startsWith("tsonic.rust.js.JSON.stringify."))
      .flatMap(occurrence => occurrence.inputs)
      .filter(({ input }) => expected ? input.source.kind === "receiver"
        : input.source.kind === "argument" && input.source.sourceIndex === 0);
    assert.equal(selected.length, 1, "the exact checked provider source has one receiver or first argument input");
    const converted = selected.filter(({ input }) => input.conversion.kind !== "identity");
    assert.equal(converted.length > 0, !expected, "the control really distinguishes a semantic transition from identity");
    for (const { input, slot } of selected) {
      assert.equal(input.mode, "ref", "the provider borrows the selected native input on both sides of the inverse");
      assert.equal(program.records.sourceParameterAbi.get(slot.node)?.mode, expected ? "ref" : "value",
        "readonly String has a native reference ABI; structural JSON storage remains an owned source value");
    }
    for (const { input, slot } of expected ? selected : converted) {
      assert.equal(program.records.providerReference.get(slot.node, input), expected,
        "only an unchanged value can reuse the parameter's existing reference");
    }
  });
}
