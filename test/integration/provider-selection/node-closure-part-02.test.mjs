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

test("generated cargo library proves async fs/promises rows", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { readFile, writeFile, readdir, stat, mkdir, rm, copyFile, rename, unlink } from "node:fs/promises";
import type { int32 } from "@tsonic/core/types.js";

export async function roundtrip(dir: string, file: string): Promise<int32> {
  await mkdir(dir);
  await writeFile(file, "async payload", "utf8");
  const text = await readFile(file, "utf8");
  const names = await readdir(dir);
  const info = await stat(file);
  const written = info.size;
  const copied = file + ".copy";
  await copyFile(file, copied);
  const renamed = file + ".renamed";
  await rename(copied, renamed);
  await unlink(renamed);
  await rm(dir);
  let total: int32 = names.length as int32;
  if (text.length > 0 && written > 0) {
    total += 1;
  }
  return total;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const roundtrip = nativeFunction(result, "roundtrip");
  assert.equal(roundtrip.visibility, "public");
  assert.deepEqual(roundtrip.params.map(parameter => parameter.type), [nativeType("String"), nativeType("String")]);
  assert.deepEqual(roundtrip.returnType, {
    kind: "named", path: "js_abi::JsPromise",
    genericArguments: [{ kind: "type", type: nativeType("i32") }],
  });
  assert.equal(roundtrip.errorType === undefined, true, "the uniform Promise object has no ambient native error channel");
  const program = result.program;
  const declaration = program.source.ast.statements(program.sourceFiles[0]).find(node =>
    program.source.ast.is.IsFunctionDeclaration(node) && program.source.ast.text(program.source.ast.name(node)) === "roundtrip");
  assert.equal(declaration !== undefined, true, "the original authored async declaration remains present");
  const emission = program.records.callableDeclaration.get(declaration);
  assert.equal(emission.nativeBody !== undefined && emission.promiseObject, true,
    "the native body and uniform Promise object keep distinct existing roles");
  const asynchronous = program.records.asyncFunction.get(declaration);
  assert.deepEqual(asynchronous.futureCarrier, {
    kind: "target-named", id: "rust.js.JsPromise",
    genericArguments: [{ kind: "type", type: { kind: "source-primitive", name: "int32" } }],
  }, "the exact canonical Promise identity and native payload remain selected");
  assert.equal(asynchronous.lowering.kind, "factory",
    "the actual fs futures require retained asynchronous execution");
  const body = nativeFunction(result, emission.nativeBody.name);
  assert.equal(body.isAsync, true, "the native body preserves its actual suspension points");
  assert.deepEqual(body.returnType, nativeType("i32"));
  assert.deepEqual(body.errorType, {
    kind: "named", path: "rt::TsonicError", identity: "tsonic-rust-runtime:TsonicError",
  }, "the native body retains the original exact runtime error channel independently of Promise rejection");
  const factory = nativeCalls(roundtrip.body, "js_abi::JsPromise::from_fallible_factory");
  assert.equal(factory.length, 1);
  assert.equal(factory[0].args[0].move, true);
  assert.equal(factory[0].args[0].async, true, "the runtime requires a static owned future body");
  const invocations = nativeCalls(factory[0], emission.nativeBody.name);
  assert.equal(invocations.length, 1, "the retained factory invokes the original native body exactly once");
  assert.deepEqual(invocations[0].args, [{ kind: "path", path: "dir" }, { kind: "path", path: "file" }]);
  assert.equal(nativeNodes(factory[0], node => node.kind === "await" && node.expr === invocations[0]).length, 1,
    "the object adapter awaits the selected native body once");
  for (const [path, arguments_] of [
    ["tsonic_rust_node::fs_promises::mkdir_async", [{ kind: "reference", expr: { kind: "path", path: "dir" } }]],
    ["tsonic_rust_node::fs_promises::read_file_string_async", [
      { kind: "reference", expr: { kind: "path", path: "file" } }, { kind: "str-literal", value: "utf8" },
    ]],
  ]) {
    const calls = nativeCalls(body.body, path);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, arguments_);
    assert.equal(nativeNodes(body.body, node => node.kind === "try" && node.expr.kind === "await" &&
      nativeCalls(node.expr, path).length === 1).length, 1, `${path} is awaited and propagates the exact failure`);
  }
  validateGeneratedProject("r7-async-fs-lib", result.artifacts);
});
