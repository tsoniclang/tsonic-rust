import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`union writes finish aliased operands before borrowing storage (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "union_assignment_order" } },
      files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
type Shape = { kind: "circle"; radius: int32 } | { kind: "square"; size: int32 };
let calls: int32 = 0;
function callCount(): int32 { return calls; }
function create(): Shape { return { kind: "circle", radius: 1 }; }
function change(shape: Shape, fail: boolean): int32 {
  calls += 1;
  if (shape.kind === "circle") shape.radius = 100;
  if (fail) throw new Error("operand");
  return 2;
}
function update(shape: Shape): void {
  if (shape.kind === "circle") {
    shape.radius += change(shape, false);
    if (shape.radius !== 3 || callCount() !== 1) throw new Error("compound order");
    shape.radius = shape.radius + 4;
    if (shape.radius !== 7) throw new Error("aliased read");
    let failed = false;
    try { shape.radius = change(shape, true); } catch { failed = true; }
    if (!failed || shape.radius !== 100 || callCount() !== 2) throw new Error("throw order");
  }
}
export function main(): void { update(create()); }
` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`union-assignment-order-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
