import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("generated Cargo fixtures preserve earlier runs without retaining stale sources", () => {
  const first = writeGeneratedProject("fixture-isolation", [{ path: "src/first.rs", text: "pub fn first() {}\n" }]);
  const second = writeGeneratedProject("fixture-isolation", [{ path: "src/second.rs", text: "pub fn second() {}\n" }]);
  assert.notEqual(first, second);
  assert.equal(readFileSync(join(first, "src/first.rs"), "utf8"), "pub fn first() {}\n");
  assert.equal(readFileSync(join(second, "src/second.rs"), "utf8"), "pub fn second() {}\n");
  assert.equal(existsSync(join(second, "src/first.rs")), false);
});
