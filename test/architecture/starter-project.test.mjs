import assert from "node:assert/strict";
import test from "node:test";
import { createTsonicPlugin } from "../../dist/index.js";

test("Rust target owns one complete immutable starter descriptor", () => {
  const plugin = createTsonicPlugin();
  const starter = plugin.createStarterProject({ projectName: "hello-rust" });
  assert.deepEqual(starter.target, {
    id: "rust",
    options: {
      crateName: "hello_rust",
      edition: "2024",
      outputType: "bin",
    },
  });
  assert.equal(starter.scripts.build, "tsonic build --project tsonic.json");
  assert.equal(starter.scripts.start, "npm run build && cargo run --manifest-path out/rust/Cargo.toml");
  assert.equal(starter.scripts.check, "npm run build && cargo check --manifest-path out/rust/Cargo.toml");
  assert.deepEqual(starter.files, [{
    path: "src/App.ts",
    contents: [
      "export function main(): void {",
      "  const answer = 40 + 2;",
      "  if (answer !== 42) {",
      '    throw new Error("unexpected answer");',
      "  }",
      "}",
      "",
    ].join("\n"),
  }]);
  assert.deepEqual(starter.requirements[0].checks.map(({ command }) => command), [
    "rustup",
    "rustc",
    "cargo",
    "rustdoc",
    "rustfmt",
  ]);
  assert.equal(Object.isFrozen(starter), true);
});
