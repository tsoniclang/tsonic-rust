import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(text) {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "promise_body_facets" } },
    files: { "index.ts": text },
  });
  assert.equal(result.diagnostics.length, 0,
    `Promise facet control: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
  return result;
}

test("an async closure uses its own object facet inside and outside a native Promise body", { timeout: 300_000 }, () => {
  const result = compile(`
import type { int32 } from "@tsonic/core/types.js";
function outside(value: int32): Promise<int32> {
  const callback = async (): Promise<int32> => value;
  return callback();
}
async function inside(value: int32): Promise<int32> {
  const callback = async (): Promise<int32> => value;
  return await callback();
}
async function main(): Promise<void> {
  if (await outside(7) !== 7 || await inside(9) !== 9) throw new Error("closure facet");
}
await main();`);
  assert.equal(validateGeneratedProject("promise-closure-facets", result.artifacts, { run: true }).status, 0,
    "both closures preserve their own result ABI and captured values");
});

test("every finite native Promise specialization has a distinct definition and exact call target", { timeout: 300_000 }, () => {
  const result = compile(`
import type { int32 } from "@tsonic/core/types.js";
abstract class Contract { abstract accept<Value>(value: Value): boolean; }
class Identity extends Contract { override accept<Value>(_value: Value): boolean { return true; } }
async function read<Value>(owner: Contract, value: Value, pending: Promise<void>, count: int32): Promise<boolean> {
  if (count > 0) return await read(owner, value, pending, count - 1);
  await pending;
  return owner.accept(value);
}
async function main(): Promise<void> {
  const owner = new Identity();
  if (!await read(owner, 7, Promise.resolve(undefined), 2) ||
      !await read(owner, "text", Promise.resolve(undefined), 3)) throw new Error("native variants");
}
await main();`);
  const rust = rustSourceText(result);
  const nativeNames = [...rust.matchAll(/fn (read_[A-Za-z0-9_]+_native)(?:<|\()/gu)].map(match => match[1]);
  assert.equal(nativeNames.length, 2, "both demanded finite variants have native definitions");
  assert.equal(new Set(nativeNames).size, 2, "variant native names are distinct");
  for (const name of nativeNames) assert.equal([...rust.matchAll(new RegExp(`\\b${name}\\b`, "gu"))].length, 3,
    `${name}: exactly its definition, selected root invocation and own recursive invocation`);
  assert.equal((rust.match(/Box::pin\(/gu) ?? []).length, 2, "each suspending specialization pins only its own recursive layout edge");
  assert.equal(validateGeneratedProject("promise-specialization-facets", result.artifacts, { run: true }).status, 0,
    "both physical variants compile and return their exact native payloads");
});
