import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
  nodejsCapability,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

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
  const size: int32 = bytes.length;
  return size + text.length;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /bytes\s*\.to_string_enc\("hex"\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /tsonic_rust_runtime::conversions::usize_to_i32\(bytes\.len\(\)\)\?/u);
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
  assert.match(text, /tsonic_rust_runtime::conversions::u64_to_f64\(info\.size\)/u);
});

test("stream scheduler target limits fail at the provider boundary", async () => {
  const cases = [
    { module: "node:fs", name: "watch", call: "watch(\"x\")" },
    { module: "node:fs", name: "createReadStream", call: "createReadStream(\"x\")" },
  ];
  for (const item of cases) {
    const options = {
      surfaces: ["js"],
      capabilities: [await nodejsCapability()],
      files: { "index.ts": `import { ${item.name} } from "${item.module}";\n\nexport function bad(): void {\n  ${item.call};\n}\n` },
    };
    assertRustTargetRejection(options, [{
      code: "RUST_PROVIDER_OPERATION_NOT_MAPPED",
      message: `No Rust operation row matches selected provider declaration 'tsonic.rust.provider-package.@tsonic/rust-nodejs.binding::tsonic.rust.node.fs::${item.module}::${item.name}::${item.module}::${item.name}(...)' as method.`,
    }]);
  }
});

test("provider package creation rejects inconsistent identity models", async () => {
  const { createRustProviderPackage } = await import("../dist/index.js");
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
