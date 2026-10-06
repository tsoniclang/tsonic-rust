import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustRuntimeCarrierKey } from "../../../dist/target-model/facts/selections.js";
import { rustSourceCallableReturnFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustFrameCallableValue } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";

const source = `
export function escaped(seed: number): (count: number) => number {
  let selected = (count: number): number => count === 0 ? seed : selected(count - 1);
  const before = selected;
  selected = (count: number): number => count === 0 ? 2 : selected(count - 1);
  return before;
}
export function ordinary(seed: number): (count: number) => number {
  return (count: number): number => count + seed;
}
`;

for (const jsEnabled of [false, true]) {
  test(`${jsEnabled ? "JS" : "native"} callable ABI selects exact activation storage before signatures and captures`, () => {
    const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": source } });
    const { ast } = program.source;
    const named = new Map();
    const arrows = [];
    const pending = [...program.sourceFiles];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (ast.is.IsFunctionDeclaration(node) || ast.is.IsVariableDeclaration(node)) {
        const name = ast.name(node);
        if (name !== undefined) named.set(ast.text(name), node);
      }
      if (ast.is.IsArrowFunction(node)) arrows.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    const escaped = named.get("escaped");
    const ordinary = named.get("ordinary");
    const selected = named.get("selected");
    const before = named.get("before");
    for (const [label, node] of [["escaped", escaped], ["ordinary", ordinary], ["selected", selected], ["before", before]])
      assert.equal(node !== undefined, true, label);
    const returned = program.facts.getFact(escaped, rustSourceCallableReturnFactKey)?.returnCarrier;
    const frame = rustFrameCallableValue(returned);
    assert.equal(frame !== undefined, true, "returned callback uses its exact activation frame");
    for (const node of [selected, before]) {
      const carrier = program.facts.getFact(node, rustRuntimeCarrierKey)?.carrier;
      assert.equal(rustTargetTypeRefEquals(carrier, returned), true, "slot and alias share the finalized physical ABI");
    }
    for (const node of arrows.filter(node => {
      let parent = ast.parent(node);
      while (parent !== undefined && !ast.is.IsFunctionDeclaration(parent)) parent = ast.parent(parent);
      return parent === escaped;
    })) {
      const carrier = program.facts.getFact(node, rustTargetOperationFactKey)?.resultCarrier;
      assert.equal(rustTargetTypeRefEquals(carrier, returned), true, "every entry retains the same owning activation");
    }
    const logical = rustCallableProtocol(returned);
    assert.equal(logical?.parameters.length, 1);
    assert.equal(rustTargetTypeRefEquals(logical?.parameters[0], rustSourcePrimitiveTargetType("float64")), true);
    assert.equal(rustTargetTypeRefEquals(logical?.result, rustSourcePrimitiveTargetType("float64")), true);
    const ordinaryResult = program.facts.getFact(ordinary, rustSourceCallableReturnFactKey)?.returnCarrier;
    assert.equal(rustFrameCallableValue(ordinaryResult) === undefined, true, "ordinary callbacks acquire no frame ABI");
    assert.equal(rustCallableProtocol(ordinaryResult)?.parameters.length, 1);
  });
}
