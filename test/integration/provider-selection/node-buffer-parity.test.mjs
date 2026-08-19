import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRust,
  nodejsCapability,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("Buffer views, copies, swaps, and numeric operations compile and execute", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "node_buffer_parity" } },
    files: {
      "index.ts": `
import { ok } from "node:assert";
import { Buffer } from "node:buffer";

export function main(): void {
  const source = Buffer.from([1, 2, 3, 4]);
  const target = Buffer.alloc(8);
  ok(source.copy(target) === 4);
  ok(source.copy(target, 2) === 4);
  ok(source.copy(target, 0, 1) === 3);
  ok(source.copy(target, 0, 0, 2) === 2);

  const selfTarget = Buffer.from([1, 2, 3, 4]);
  ok(selfTarget.copy(selfTarget, 1, 0, 3) === 3);
  ok(selfTarget.readUInt8(1) === 1);
  ok(selfTarget.readUInt8(2) === 2);
  ok(selfTarget.readUInt8(3) === 3);

  const firstView = target.slice(0, 4);
  const secondView = firstView.subarray(1, 3);
  ok(secondView.writeUInt8(9) === 1);
  ok(target.readUInt8(1) === 9);

  const swap = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const alias16 = swap.swap16();
  alias16.writeUInt8(10);
  ok(swap.readUInt8() === 10);
  swap.swap32();
  swap.swap64();

  const numeric = Buffer.alloc(48);
  ok(numeric.writeInt8(-2, 0) === 1);
  ok(numeric.writeUInt16LE(4660, 1) === 3);
  ok(numeric.writeUInt16BE(22136, 3) === 5);
  ok(numeric.writeInt16LE(-1234, 5) === 7);
  ok(numeric.writeInt16BE(-2345, 7) === 9);
  ok(numeric.writeUInt32LE(305419896, 9) === 13);
  ok(numeric.writeUInt32BE(4275878552, 13) === 17);
  ok(numeric.writeInt32LE(-123456, 17) === 21);
  ok(numeric.writeInt32BE(-654321, 21) === 25);
  ok(numeric.writeFloatLE(1.5, 25) === 29);
  ok(numeric.writeFloatBE(-2.25, 29) === 33);
  ok(numeric.writeDoubleLE(1234.5, 32) === 40);
  ok(numeric.writeDoubleBE(-0.5, 40) === 48);

  ok(numeric.readInt8(0) === -2);
  ok(numeric.readUInt16LE(1) === 4660);
  ok(numeric.readUInt16BE(3) === 22136);
  ok(numeric.readInt16LE(5) === -1234);
  ok(numeric.readInt16BE(7) === -2345);
  ok(numeric.readUInt32LE(9) === 305419896);
  ok(numeric.readUInt32BE(13) === 4275878552);
  ok(numeric.readInt32LE(17) === -123456);
  ok(numeric.readInt32BE(21) === -654321);
  ok(numeric.readFloatLE(25) === 1.5);
  ok(numeric.readFloatBE(29) === -2.25);
  ok(numeric.readDoubleLE(32) === 1234.5);
  ok(numeric.readDoubleBE(40) === -0.5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /tsonic_rust_node::buffer::copy_open_number/u);
  assert.match(source, /tsonic_rust_node::buffer::slice_closed_number/u);
  assert.match(source, /tsonic_rust_node::buffer::write_uint32_be_number/u);
  assert.match(source, /tsonic_rust_node::buffer::read_double_be_number/u);
  const run = validateGeneratedProject("node-buffer-parity-20260817", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
