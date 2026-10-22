import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeNodes, nativeCalls, nativeDispatchBinding } from "../../helpers/native-ast.mjs";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
  nodejsCapability,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("cross-module provider-ref members resolve without duplicate declarations", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { randomBytes } from "node:crypto";
import type { int32 } from "@tsonic/core/types.js";

export function probe(): int32 {
  const bytes = randomBytes(8);
  const text = bytes.toString("hex");
  const size: int32 = bytes.length as int32;
  return size + (text.length as int32);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /bytes\.to_string_enc\("hex"\)\?/u);
  assert.match(text, /rt::conversions::usize_to_i32\(bytes\.len\(\)\)\?/u);
});

test("generated cargo binary proves hmac, base64, and cross-module members at runtime", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r9_proof" } },
    files: {
      "index.ts": `
import { createHmac, randomBytes } from "node:crypto";
import { btoa, atob, isEncoding } from "node:buffer";
import { canParse } from "node:url";
import { getSystemErrorMessage } from "node:util";
import { stat, writeFile, rm } from "node:fs/promises";
import { check } from "@acme/testing";

export function main(): void {
  let ok = false;
  try {
    const mac = createHmac("sha256", "key");
    mac.update("abc");
    const digest = mac.digest("hex");
    check(digest.length === 64);
    check(btoa("abc") === "YWJj");
    check(atob("YWJj") === "abc");
    check(atob("YQ") === "a");
    check(atob("YQ=") === "a");
    const bytes = randomBytes(8);
    check(bytes.length === 8);
    check(bytes.toString("hex").length === 16);
    ok = true;
  } catch (error) {
    ok = false;
  }
  check(ok);
  check(isEncoding("utf8"));
  check(!isEncoding("nope"));
  check(canParse("https://example.com"));
  check(!canParse("not a url"));
  const message = getSystemErrorMessage(-2);
  check(message.length > 0);
}
main();
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("r9-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("fs/promises stat members resolve through the imported Stats declaration", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { stat } from "node:fs/promises";

export async function size_of(path: string): Promise<boolean> {
  const info = await stat(path);
  return info.isFile() && info.size > 0;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /info\.is_file\(\)/u);
  assert.match(text, /info\.size != 0/u);
  assert.doesNotMatch(text, /u64_to_f64|info\.size as f64/u);
});

test("stream scheduler operations lower through exact provider rows", async () => {
  const cases = [
    { name: "watch", target: "watch", hasTasks: false, rootType: "tsonic_rust_node::fs::Watchers" },
    { name: "createReadStream", target: "create_read_stream", hasTasks: true, rootType: "tsonic_rust_node::background::BackgroundTasks" },
  ];
  for (const item of cases) {
    const { result } = compileRust({
      surfaces: ["js"],
      capabilities: [await nodejsCapability()],
      files: {
        "index.ts": `import { ${item.name} } from "node:fs";\n\nexport function selected(): void {\n  ${item.name}("x");\n}\n`,
      },
    });
    assert.deepEqual(result.diagnostics, []);
    const selected = nativeFunction(result, "selected");
    const path = `tsonic_rust_node::fs::${item.target}`;
    const calls = nativeCalls(selected.body, path);
    assert.equal(calls.length, 1, `${item.name} selects its exact provider row`);
    const selectedCall = calls[0];
    assert.equal(selectedCall.args.length, item.hasTasks ? 3 : 2);
    nativeDispatchBinding(result, selected.body, selectedCall, selectedCall.args[0].path, item.rootType);
    if (item.hasTasks) {
      const tasks = selectedCall.args[1];
      assert.equal(tasks.kind, "method-call");
      assert.equal(tasks.method, "handle");
      assert.deepEqual(tasks.args, []);
      nativeDispatchBinding(result, selected.body, selectedCall, tasks.receiver.path, "tsonic_rust_node::runtime_tasks::RuntimeTasks");
    }
    assert.deepEqual(selectedCall.args.at(-1), { kind: "str-literal", value: "x" });
    assert.equal(nativeNodes(selected.body, node => node.kind === "try" && nativeCalls(node.expr, path).length === 1).length,
      1, "provider scheduling failure propagates");
  }
});

test("provider package creation rejects inconsistent identity models", async () => {
  const { createRustProviderPackage } = await import("../../../dist/public/provider.js");
  const base = { id: "bad", displayName: "Bad", version: "1.0.0", crates: [] };
  const fn = (m, name) => ({ id: `${m}::${name}`, name, kind: "function", signatures: [{ id: `${m}::${name}()`, name, parameters: [], returnType: { kind: "void" } }] });
  const cases = [
    {
      label: "duplicate module",
      modules: [
        { moduleSpecifier: "m:a", providerModuleId: "a", exports: [] },
        { moduleSpecifier: "m:a", providerModuleId: "a2", exports: [] },
      ],
      operations: [],
      pattern: /duplicate module/u,
    },
    {
      label: "duplicate export",
      modules: [{ moduleSpecifier: "m:a", providerModuleId: "a", exports: [fn("m:a", "f"), fn("m:a", "f")] }],
      operations: [],
      pattern: /duplicate export/u,
    },
    {
      label: "bad import",
      modules: [{ moduleSpecifier: "m:a", providerModuleId: "a", imports: [{ moduleSpecifier: "m:missing", namedImports: [{ exportedName: "X" }] }], exports: [] }],
      operations: [],
      pattern: /undeclared module/u,
    },
    {
      label: "undeclared provider ref",
      modules: [{
        moduleSpecifier: "m:a",
        providerModuleId: "a",
        exports: [{ id: "m:a::g", name: "g", kind: "function", signatures: [{ id: "m:a::g()", name: "g", parameters: [], returnType: { kind: "provider-ref", moduleSpecifier: "m:a", exportName: "Nope" } }] }],
      }],
      operations: [],
      pattern: /references provider export/u,
    },
    {
      label: "bad exportId row",
      modules: [{ moduleSpecifier: "m:a", providerModuleId: "a", exports: [fn("m:a", "f")] }],
      operations: [{ exportId: "m:a::missing", operationKind: "method", target: { form: "call", path: "x::y" }, resultCarrier: { kind: "source-primitive", name: "int32" } }],
      pattern: /undeclared exportId/u,
    },
  ];
  for (const item of cases) {
    assert.throws(
      () => createRustProviderPackage({ ...base, modules: item.modules, operations: item.operations }),
      item.pattern,
      item.label,
    );
  }
});
