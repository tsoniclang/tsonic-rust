import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  test(`nested quantified owners retain body-only type captures, aliases and separate activations in ${profile}`,
    { timeout: 300_000 }, () => {
      const name = `nested_quantified_owner_${profile}`;
      const { result } = compileRust({
        surfaces,
        packages: [acmeTestingPackage()],
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": `
import { check } from "@acme/testing";
const create = <Outer>(seed: Outer) => {
  let calls = 0;
  return <Value>(value: Value): Value => {
    const held: Outer[] = [seed];
    if (held.length === 0) throw new Error("missing capture");
    calls += 1;
    if (calls === 3) throw new Error("third invocation");
    return value;
  };
};
export function main(): void {
  const first = create(3);
  const alias = first;
  const second = create("seed");
  check(first === alias && first !== create(3));
  check(first("left") === "left");
  check(alias(2) === 2);
  let failed = false;
  try { first("third"); } catch { failed = true; }
  check(failed);
  check(second(1) === 1 && second("right") === "right");
}
` },
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 8)
        .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
      const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
        .map(artifact => artifact.text).join("\n");
      assert.match(generated, /CallableEnvironment[^\n]*</u);
      assert.doesNotMatch(generated, /dyn (?:Any|Fn)|downcast|unsafe/u);
      const native = validateGeneratedProject(name, result.artifacts, { run: true });
      assert.equal(native.status, 0, native.stdout + native.stderr);
    });
  test(`unconstrained generic equality remains a precise rejection in ${profile}`, () => {
    const { result } = compileRust({
      surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `unbounded_generic_equality_${profile}` } },
      files: { "index.ts": `
function same<Value>(value: Value): boolean { return value === value; }
export function main(): void { if (!same(3)) throw new Error("equal"); }
` },
    });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED"), true);
    assert.equal(result.artifacts.length, 0);
  });
}
