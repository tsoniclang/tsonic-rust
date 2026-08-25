import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  acmeVectorsPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("provider operator metadata lowers a selected source call to a native operator", () => {
  const { result } = compileRust({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Vector } from "@acme/vectors";

export function combine(): int32 {
  const a = new Vector(1, 2);
  const b = new Vector(3, 4);
  const c = Vector.add(a, b);
  return c.x + c.y;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let c: acme_vectors::Vector = a \+ b;/u);
  assert.match(text, /acme_vectors::Vector::new\(1, 2\)/u);
  assert.match(text, /c\.x \+ c\.y/u);
});

test("invalid TypeScript operators on provider types are not rescued by Rust traits", () => {
  const harness = compileRust;
  let threw = false;
  try {
    harness({
      packages: [acmeVectorsPackage()],
      files: {
        "index.ts": `
import { Vector } from "@acme/vectors";

export function bad(): void {
  const a = new Vector(1, 2);
  const b = new Vector(3, 4);
  const c = a + b;
}
`,
      },
    });
  } catch (error) {
    threw = true;
    assert.match(String(error), /TypeScript diagnostics/u);
  }
  assert.ok(threw, "TS must reject operator use on provider class instances");
});

test("generated cargo binary proves operator-trait lowering at runtime", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeVectorsPackage(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r4_ops_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { move, mut, ref } from "@tsonic/rust/lang.js";
import { Vector, magnitude, consume, scale } from "@acme/vectors";
import { check } from "@acme/testing";

export function main(): void {
  const a = new Vector(1, 2);
  const b = new Vector(3, 4);
  const c = Vector.add(a, b);
  check(c.x === 4);
  check(c.y === 6);
  check(magnitude(ref(c)) === 52);
  scale(mut(c), 2);
  check(c.x === 8);
  check(c.y === 12);
  check(consume(move(c)) === 20);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /acme_vectors::magnitude\(&c\)/u);
  assert.match(source, /acme_vectors::scale\(&mut c, 2\)/u);
  assert.match(source, /acme_vectors::consume\(c\)/u);
  assert.doesNotMatch(source, /acme_vectors::consume\(c\.clone\(\)\)/u);
  const run = validateGeneratedProject("operator-traits-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
