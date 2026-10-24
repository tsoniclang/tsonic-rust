import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

import { rustCallableInputProtocol } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../../../dist/analysis/conversions/value-carrier-queries.js";

for (const surfaces of [[], ["js"]]) {
  test(`invocation-only source formals borrow while retained and reassigned formals keep ownership in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
function invoke(direct: (value: number) => number): number { return direct(2); }
function retained(owned: (value: number) => number): (value: number) => number { return owned; }
function captured(capture: (value: number) => number): () => number { return () => capture(3); }
function reassigned(mutable: (value: number) => number): number { mutable = value => value + 1; return mutable(4); }
function observed(observedInput: (value: number) => number): number { return observedInput(5); }
const observedAlias = observed;
const invokeClosure = (closureInput: (value: number) => number): number => closureInput(6);
function defaulted(defaultInput: (value: number) => number = value => value + 2): number { return defaultInput(7); }
function optional(optionalInput?: (value: number) => number): number { return optionalInput?.(8) ?? 10; }
export function main(): void {
  const value = (input: number): number => input + 2;
  if (invoke(value) !== 4 || retained(value)(3) !== 5 || captured(value)() !== 5 || reassigned(value) !== 5 ||
    observedAlias(value) !== 7 || invokeClosure(value) !== 8 || defaulted(value) !== 9 || optional(value) !== 10) {
    throw new Error("callable ownership");
  }
}
` } });
    const { ast } = program.source;
    const found = new Set();
    const visit = node => {
      if (ast.is.IsParameterDeclaration(node)) {
        const name = ast.text(ast.name(node));
        if (["direct", "owned", "capture", "mutable", "observedInput", "closureInput", "defaultInput", "optionalInput"].includes(name)) {
          const abi = program.records.sourceParameterAbi.get(node);
          assert.equal(abi !== undefined, true, `exact ${name} ABI`);
          assert.equal(rustCallableInputProtocol(abi.valueCarrier) !== undefined, name === "direct");
          if (name === "direct") {
            assert.equal(abi.mode, "value", "the selected carrier is already the native borrowed input");
            assert.equal(abi.parameterCarrier.kind, "reference");
          }
          if (name === "defaultInput") {
            const initializer = ast.as.AsParameterDeclaration(node).Initializer;
            assert.equal(ast.is.IsArrowFunction(initializer), true, "the actual authored default callback is retained");
            assert.equal(rustTargetTypeRefEquals(rustEffectiveValueCarrier(program.records, initializer), abi.valueCarrier), true,
              "the default initializer consumes its admitted native value conversion, not a raw carrier equality guess");
          }
          found.add(name);
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
    assert.equal(found.size, 8);
  });
}
