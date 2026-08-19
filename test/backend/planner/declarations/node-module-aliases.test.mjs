import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRust,
  nodejsCapability,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("bare Node module aliases retain canonical provider operations", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "node_module_aliases" } },
    files: {
      "index.ts": `
import { ok } from "assert";
import { ok as strictOk } from "assert/strict";
import { ok as nodeStrictOk } from "node:assert/strict";
import { Buffer } from "buffer";
import { createHash } from "crypto";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import { createServer } from "http";
import { hostname } from "os";
import { join } from "path";
import process from "process";
import { setTimeout } from "timers";
import { stripVTControlCharacters } from "util";
import { URL } from "url";

export function main(): void {
  const file = join(process.cwd(), "node-module-alias-proof.txt");
  writeFileSync(file, "alias", "utf8");
  ok(readFileSync(file, "utf8") === "alias");
  rmSync(file, true);

  strictOk(Buffer.from("ok", "utf8").toString("utf8") === "ok");
  nodeStrictOk(createHash("sha256").update("alias").digest("hex").length === 64);
  ok(new URL("https://example.com/path").pathname === "/path");
  ok(hostname().length > 0);
  ok(stripVTControlCharacters("plain") === "plain");
  setTimeout(() => {}, 0);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /tsonic_rust_node::fs::read_file_sync_string/u);
  assert.match(source, /tsonic_rust_node::crypto::create_hash/u);
  assert.match(source, /tsonic_rust_node::process::cwd/u);
  const run = validateGeneratedProject("node-module-aliases-20260817", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
