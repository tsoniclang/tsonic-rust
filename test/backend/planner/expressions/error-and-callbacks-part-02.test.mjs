import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeNodes, nativeCalls, nativeType, nativeBorrow, assertNoNativeCalls } from "../../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, nodejsCapability } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("terminating try scopes nested in non-tail branches return through the enclosing function", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "nested_try_return" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class DomainError extends Error {
  constructor(message: string) { super(message); }
}

function fail(): void {
  throw new DomainError("domain");
}

function recover(active: boolean): string | undefined {
  if (active) {
    try {
      fail();
      return "unreachable";
    } catch (error) {
      if (error instanceof DomainError) return error.message;
      throw error;
    }
  }
  return undefined;
}

export function main(): void {
  check(recover(true) === "domain");
  check(recover(false) === undefined);
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Completion::Return\(value\) => return Ok\(value\)/u);
  assert.equal(validateGeneratedProject("nested-try-return", result.artifacts, { run: true }).status, 0);
});

test("nested arrow returns do not trip the try escape scan", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(): int32 {
  throw new Error("x");
}

export function safe(xs: int32[]): int32 {
  let doubled_len: int32 = 0;
  try {
    risky();
    doubled_len = xs.map((x) => x * 2).length as int32;
  } catch (error) {
    doubled_len = -1;
  }
  return doubled_len;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /xs\.map\(\|x\| x \* 2\)/u);
});

test("fallible index operations require their exact native error carrier", async () => {
  const { createRustProviderPackage } = await import("../../../../dist/public/provider.js");
  assert.throws(
    () => createRustProviderPackage({
      id: "bad",
      displayName: "Bad",
      version: "1.0.0",
      modules: [{
        moduleSpecifier: "@bad",
        providerModuleId: "bad",
        exports: [{
          id: "@bad::X",
          name: "X",
          kind: "class",
          members: [{
            id: "@bad::X.indexer",
            name: "indexer",
            kind: "indexer",
            signatures: [{
              id: "@bad::X.indexer(index)",
              parameters: [{ name: "index", type: { kind: "number" } }],
              returnType: { kind: "source-primitive", name: "int32" },
            }],
          }],
        }],
      }],
      operations: [{
        exportId: "@bad::X",
        memberId: "@bad::X.indexer",
        signatureId: "@bad::X.indexer(index)",
        operationKind: "indexer",
        target: { form: "index" },
        resultCarrier: { kind: "source-primitive", name: "int32" },
        parameterCarriers: [{ kind: "source-primitive", name: "float64" }],
        isFallible: true,
        errorBoundary: "provider-native",
      }],
      crates: [],
    }),
    /provider-native row .* requires an exact errorCarrier/u,
  );
});

test("concise fallible callables convert provider errors into the closed program error", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "concise_program_error" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class DomainError extends Error {
  constructor(message: string) { super(message); }
}

const normalize = (value: string): string => value.replaceAll("a", "b");

function fail(): void {
  throw new DomainError("domain");
}

export function main(): void {
  check(normalize("a") === "b");
  try {
    fail();
  } catch (_error) {
    check(true);
  }
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(nativeFunction(result, "normalize").errorType.path, "rt::JsError");
  assert.match(
    source,
    /fn normalize\(value: &str\) -> Result<String, rt::JsError> \{\s*js_string::replace_all\(core::convert::AsRef::<str>::as_ref\(value\), "a", "b"\)\s*\}/u,
  );
  assert.equal(validateGeneratedProject("concise-program-error", result.artifacts, { run: true }).status, 0);
});

test("source-program callback operations retain the current project error domain", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class DomainError extends Error {
  constructor(message: string) { super(message); }
}

function risky(value: int32): int32 {
  if (value < 0) throw new DomainError("negative");
  return value;
}

export function sorted(values: int32[]): int32[] {
  return values.sort((left, right) => risky(left) - risky(right));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn sorted[\s\S]*?\{\n\s*values\s*\.try_sort/u);
  assert.doesNotMatch(source, /Ok::<_, rt::TsonicError>\(\s*values\s*\.try_sort/u);
});

test("capture-free exact forwarding callbacks use their native Rust function directly", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
function compare(left: number, right: number): number {
  if (left < 0 || right < 0) throw new Error("negative");
  return left - right;
}

export function sorted(values: number[]): number[] {
  return values.sort((left, right) => compare(left, right));
}

export function reversed(values: number[]): number[] {
  return values.sort((left, right) => compare(right, left));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\.try_sort\(compare\)/u);
  assert.match(source, /values\.try_sort\(\|left, right\| compare\(right, left\)\)/u);
});
