import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [undefined, ["js"]]) {
  test(`implicit constructor effects preserve initializer and inherited failures in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
function failure(): number { throw new Error("initializer"); }
class Pure { value: number = 3; }
class Initializer { value: number = failure(); }
class Derived extends Initializer {}
class Base { constructor() { failure(); } }
class Inherited extends Base {}
export function main(): void {
  if (new Pure().value !== 3) throw new Error("pure constructor");
  let caught = 0;
  try { new Initializer(); } catch { caught += 1; }
  try { new Derived(); } catch { caught += 1; }
  try { new Inherited(); } catch { caught += 1; }
  if (caught !== 3) throw new Error("constructor failure lost");
}
main();
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => `${row.code}: ${row.message}`).join("\n"));
    assert.doesNotMatch(artifactText(result, "src/index.rs"), /catch_unwind|panic_any/u);
    validateGeneratedProject(`implicit-constructor-effects-${surfaces?.[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
