import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("cross-module provider-ref members resolve without duplicate declarations", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packageIds: ["nodejs"],
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
  assert.match(text, /bytes\.to_string_enc\("hex"\)\?/u);
  assert.match(text, /bytes\.len\(\) as i32/u);
});

test("generated cargo binary proves hmac, base64, and cross-module members at runtime", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packageIds: ["nodejs"],
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

test("fs/promises stat members resolve through the imported Stats declaration", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packageIds: ["nodejs"],
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
  assert.match(text, /info\.size as f64/u);
});

test("remaining blocked lanes stay classified", () => {
  const cases = [
    { module: "node:util", name: "inspect", call: "inspect(\"x\")" },
    { module: "node:fs", name: "watch", call: "watch(\"x\")" },
    { module: "node:url", name: "format", call: "format(\"x\")" },
  ];
  for (const item of cases) {
    const { result } = compileRust({
      surfaces: ["js"],
      packageIds: ["nodejs"],
      files: { "index.ts": `import { ${item.name} } from "${item.module}";\n\nexport function bad(): void {\n  ${item.call};\n}\n` },
    });
    assert.equal(result.artifacts.length, 0, `${item.module}::${item.name}`);
    assert.ok(result.diagnostics.length > 0);
  }
});
