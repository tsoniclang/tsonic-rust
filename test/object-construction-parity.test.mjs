import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("object spread evaluates each source once and applies contributions in source order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "object_spread_order" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Point {
  x: int32;
  y: int32;
}

let order: int32 = 0;

function first(): Point {
  order = order * 10 + 1;
  return { x: 1, y: 2 };
}

function second(): Point {
  order = order * 10 + 2;
  return { x: 3, y: 4 };
}

function replacement(): int32 {
  order = order * 10 + 3;
  return 8;
}

export function main(): void {
  const point: Point = {
    ...first(),
    ...second(),
    y: replacement(),
  };
  check(order === 123);
  check(point.x === 3);
  check(point.y === 8);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal((source.match(/= first\(\);/gu) ?? []).length, 1, source);
  assert.equal((source.match(/= second\(\);/gu) ?? []).length, 1, source);
  assert.equal((source.match(/= replacement\(\);/gu) ?? []).length, 1, source);
  assert.equal(validateGeneratedProject("object-spread-order", result.artifacts, { run: true }).status, 0);
});
