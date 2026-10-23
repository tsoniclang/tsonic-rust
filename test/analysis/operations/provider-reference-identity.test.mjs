import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const [name, source, expected] of [
  ["semantic object-to-JsValue conversion", "export function render(value: { title: string }): string | undefined { return JSON.stringify(value); } console.log(render({title: 'x'}));", false],
  ["unchanged borrowed string", "export function read(value: string): number { return value.indexOf('x'); } console.log(read('x'));", true],
]) {
  test(`provider reference ${name} keeps the selected converted value`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
    const selected = program.physicalEmissionContexts.sourceOccurrences.flatMap(occurrence => occurrence.inputs)
      .filter(({ input, slot }) => input.mode === "ref" && program.records.sourceParameterAbi.get(slot.node)?.mode === "ref");
    assert.equal(selected.length > 0, true, "the real source contains an actual borrowed parameter provider input");
    const converted = selected.filter(({ input }) => input.conversion.kind !== "identity");
    assert.equal(converted.length > 0, !expected, "the control really distinguishes a semantic transition from identity");
    for (const { input, slot } of expected ? selected : converted) {
      assert.equal(program.records.providerReference.get(slot.node, input), expected,
        "only an unchanged value can reuse the parameter's existing reference");
    }
  });
}
