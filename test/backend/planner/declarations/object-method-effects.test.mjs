import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustFallibleFactKey, rustSourceCallEffectsFactKey } from "../../../../dist/analysis/facts/keys.js";

const source = `
async function fail(): Promise<void> { throw new Error("selected rejection"); }
export const api = {
  async reject(): Promise<void> { await fail(); },
  async forward(): Promise<void> { await api.reject(); },
  async caught(): Promise<void> { try { await fail(); } catch {} },
  async plain(): Promise<void> {},
};
export async function invoke(): Promise<void> { await api.forward(); }
`;

for (const surfaces of [[], ["js"]]) {
  test(`object method effects retain deferred rejection and caught controls (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const methods = new Map();
    const visit = node => {
      if (program.source.ast.is.IsMethodDeclaration(node)) {
        methods.set(program.source.ast.text(program.source.ast.name(node)), node);
      }
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    for (const name of ["reject", "forward", "caught", "plain"]) {
      assert.equal(methods.has(name), true, name);
      const declaration = methods.get(name);
      assert.equal(program.facts.getFact(declaration, rustFallibleFactKey) !== undefined,
        name === "reject" || name === "forward", name);
      const effects = program.facts.getFact(declaration, rustSourceCallEffectsFactKey);
      assert.equal(effects !== undefined, true, name);
      assert.equal(effects.invocation, "infallible", name);
      assert.equal(effects.awaiting, name === "reject" || name === "forward" ? "fallible" : "infallible", name);
    }
  });
}
