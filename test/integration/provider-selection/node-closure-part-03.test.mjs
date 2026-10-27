import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeCalls, nativeNodes, nativeType, nativeBorrow, nativeDispatchBinding } from "../../helpers/native-ast.mjs";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
  nodejsCapability,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("process env writes retain native environment identity and remove absent values", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "process_environment_values" } },
    files: {
      "index.ts": `
import { env } from "node:process";
import { check } from "@acme/testing";

export function main(): void {
  const name = "TSONIC_ENVIRONMENT_WRITE_PROOF";
  const previous = env[name];
  env[name] = "1";
  check(env[name] === "1");
  env[name] = undefined;
  check(env[name] === undefined);
  if (previous !== undefined) env[name] = previous;
}
main();
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("process-environment-values", result.artifacts, { run: true });
});

test("absent env reads preserve undefined", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { env } from "node:process";

export function read(name: string): string {
  const value = env[name];
  if (value === undefined) {
    return "";
  }
  return value ?? "";
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::process::environment\(\)\.get\(&name\)/u);
  assert.match(text, /value\.is_none\(\)/u);
});

test("filesystem stream constructors and lifecycle methods lower together", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { createReadStream, createWriteStream } from "node:fs";

export function closeStreams(inputPath: string, outputPath: string): void {
  const readable = createReadStream(inputPath);
  const writable = createWriteStream(outputPath);
  readable.close();
  writable.close();
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const close = nativeFunction(result, "closeStreams");
  assert.equal(close.visibility, "public");
  assert.deepEqual(close.params.map(parameter => parameter.type), [nativeBorrow(nativeType("str")), nativeBorrow(nativeType("str"))]);
  for (const [operation, parameter, hasTasks] of [["create_read_stream", "inputPath", true], ["create_write_stream", "outputPath", false]]) {
    const path = `tsonic_rust_node::fs::${operation}`;
    const calls = nativeCalls(close.body, path);
    assert.equal(calls.length, 1);
    const selectedCall = calls[0];
    assert.equal(selectedCall.args.length, hasTasks ? 3 : 2);
    nativeDispatchBinding(result, close.body, selectedCall, selectedCall.args[0].path, "tsonic_rust_node::background::BackgroundTasks");
    if (hasTasks) {
      const tasks = selectedCall.args[1];
      assert.equal(tasks.kind, "method-call");
      assert.equal(tasks.method, "handle");
      assert.deepEqual(tasks.args, []);
      nativeDispatchBinding(result, close.body, selectedCall, tasks.receiver.path, "tsonic_rust_node::runtime_tasks::RuntimeTasks");
    }
    assert.deepEqual(selectedCall.args.at(-1), { kind: "call", path: "core::convert::AsRef::<str>::as_ref",
      args: [{ kind: "path", path: parameter }] });
  }
  for (const receiver of ["readable", "writable"]) {
    assert.equal(nativeNodes(close.body, node => node.kind === "try" && node.expr.kind === "method-call" &&
      node.expr.method === "close" && node.expr.receiver.path === receiver).length, 1, `${receiver} close failure propagates`);
  }
  validateGeneratedProject("r9-node-stream-constructors", result.artifacts);
});
