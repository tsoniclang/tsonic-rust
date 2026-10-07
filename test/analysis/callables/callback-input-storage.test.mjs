import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCallableInputProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { isRustStringCarrier } from "../../../dist/target-model/types/index.js";

const measurement = `
function measureInput(input: string, inspect: (value: string) => number): number { return inspect(input); }
`;
const caller = `
export function measuredInline(input: string): number { return measureInput(input, value => value.length); }
export function main(): void { if (measuredInline("native") !== 6) throw new Error("borrowed input"); }
`;

for (const order of ["callee-first", "caller-first"]) {
  test(`invocation-only callback input borrows select their own storage origins ${order}`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: {
      "index.ts": order === "callee-first" ? measurement + caller : caller + measurement,
    } });
    const declarations = new Map();
    const ast = program.source.ast;
    const visit = node => {
      if (ast.is.IsFunctionDeclaration(node)) declarations.set(ast.text(ast.name(node)), node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    for (const name of ["measureInput", "measuredInline"]) {
      const parameter = ast.parameters(declarations.get(name))[0];
      const abi = program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
      assert.equal(abi?.mode === "ref" && abi.parameterCarrier.kind === "reference" &&
        !abi.parameterCarrier.mutable && isRustStringCarrier(abi.parameterCarrier.referent), true,
      `${name} publishes the identical immutable native string borrow`);
    }
    const callbackParameter = ast.parameters(declarations.get("measureInput"))[1];
    const callback = program.facts.getFact(callbackParameter, rustSourceParameterAbiFactKey);
    const protocol = rustCallableInputProtocol(callback?.valueCarrier);
    assert.equal(protocol?.parameters[0]?.kind === "reference" && isRustStringCarrier(protocol.parameters[0].referent), true,
      "the callback argument owner, not the enclosing string's origins, supplies the invocation protocol");
  });
}
