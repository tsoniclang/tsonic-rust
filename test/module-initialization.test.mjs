import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeFilesPackage,
  acmePlatformPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("binary module initialization preserves dependency and source evaluation order", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "module_order_proof" },
    },
    files: {
      "state.ts": `
import type { int32 } from "@tsonic/core/types.js";

let sequence: int32 = 1;
sequence += 1;

export function next(): int32 {
  sequence += 1;
  return sequence;
}
`,
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { next } from "./state.js";

export const first: int32 = next();
export let second: int32 = first + 1, third: int32 = second + 1;
third += 1;

export function main(): void {
  if (first !== 3 || second !== 4 || third !== 6) {
    throw new Error("module evaluation order mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const main = artifactText(result, "src/main.rs");
  assert.equal(
    main.includes("module_order_proof::__tsonic_initialize()"),
    true,
  );
  const library = artifactText(result, "src/lib.rs");
  assert.equal(
    library.indexOf("crate::state::__tsonic_module_init()") <
      library.indexOf("crate::index::__tsonic_module_init()"),
    true,
  );
  const index = artifactText(result, "src/index.rs");
  const initializationBody = index.slice(index.indexOf("pub fn __tsonic_module_init"));
  const firstInitialization = initializationBody.indexOf("crate::state::next()");
  const secondInitialization = initializationBody.indexOf("FIRST.with(");
  const thirdInitialization = initializationBody.indexOf("SECOND.with(");
  const finalWrite = initializationBody.lastIndexOf(".store(");
  assert.equal(firstInitialization >= 0, true);
  assert.equal(firstInitialization < secondInitialization, true);
  assert.equal(secondInitialization < thirdInitialization, true);
  assert.equal(thirdInitialization < finalWrite, true);
  validateGeneratedProject("module-order-proof", result.artifacts, { run: true });
});

test("function-only runtime module cycles require no initialization ordering", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "module_cycle_rejection" },
    },
    files: {
      "a.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromB } from "./b.js";

export function fromA(value: int32): int32 {
  return value <= 0 ? 1 : fromB(value - 1) + 1;
}
`,
      "b.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromA } from "./a.js";

export function fromB(value: int32): int32 {
  return value <= 0 ? 1 : fromA(value - 1) + 1;
}
`,
      "index.ts": `
import { fromA } from "./a.js";

export function main(): void {
  if (fromA(3) !== 4) {
    throw new Error("cyclic function call mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/main.rs"), /__tsonic_module_init/u);
  validateGeneratedProject("module-cycle-functions", result.artifacts, { run: true });
});

test("a cyclic component with one initializer fails without cyclic call evidence", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "module_cycle_single_init" },
    },
    files: {
      "a.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromB } from "./b.js";

export let value: int32 = 4;
export function fromA(): int32 { return fromB() + value; }
`,
      "b.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromA } from "./a.js";

export function fromB(): int32 { return 3; }
export function cycleReference(): int32 { return fromA(); }
`,
      "index.ts": `
import { fromA } from "./a.js";

export function main(): void {
  if (fromA() !== 7) {
    throw new Error("single cyclic initializer mismatch");
  }
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.filter((diagnostic) =>
    diagnostic.code === "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE").length, 1);
});

test("cycles with competing runtime initializers fail before publication", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "module_cycle_rejection" },
    },
    files: {
      "a.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromB } from "./b.js";
export let fromA: int32 = fromB + 1;
`,
      "b.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromA } from "./a.js";
export let fromB: int32 = fromA + 1;
`,
      "index.ts": `
import { fromA } from "./a.js";
export function main(): void { if (fromA === 0) { throw new Error("unreachable"); } }
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.filter((diagnostic) =>
    diagnostic.code === "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE").length, 1);
});

test("top-level await runs before the binary entry function", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "async_module_proof" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

async function load(): Promise<int32> {
  return 7;
}

export let value: int32 = await load();

export function main(): void {
  if (value !== 7) {
    throw new Error("async module initialization mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /pub async fn __tsonic_module_init\(\)[\s\S]*?let __tsonic_module_value_\d+ = load\(\)\.await;[\s\S]*?\.initialize\(__tsonic_module_value_\d+\)/u,
  );
  assert.match(
    artifactText(result, "src/main.rs"),
    /tsonic_rust_runtime::block_on\(async_module_proof::__tsonic_initialize\(\)\)/u,
  );
  validateGeneratedProject("async-module-proof", result.artifacts, { run: true });
});

test("fallible top-level operations propagate through binary startup", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "fallible_module_proof" },
    },
    files: {
      "index.ts": `
export let value: unknown = JSON.parse("1");

export function main(): void {}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /pub fn __tsonic_module_init\(\) -> rt::TsonicResult<\(\)>[\s\S]*?json_parse\("1"\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u,
  );
  assert.match(
    artifactText(result, "src/main.rs"),
    /fallible_module_proof::__tsonic_initialize\(\)\?;/u,
  );
  validateGeneratedProject("fallible-module-proof", result.artifacts, { run: true });
});

test("an active provider crate runs its declared binary epilogue after authored main", () => {
  const { result } = compileRust({
    packages: [acmeFilesPackage({
      binaryEpilogues: [{
        id: "drain-runtime",
        path: "acme_files::drain_runtime",
        requiredCrate: "acme_files",
      }],
    })],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "provider_epilogue_proof" },
    },
    files: {
      "index.ts": `
import { readText } from "@acme/files";

export function main(): void {
  readText("unused");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const main = artifactText(result, "src/main.rs");
  assert.equal(main.indexOf("provider_epilogue_proof::index::main()") <
    main.indexOf("acme_files::drain_runtime()"), true);
  validateGeneratedProject("provider-epilogue-proof", result.artifacts);
});

test("a type-only provider selection does not activate its binary epilogue", () => {
  const { result } = compileRust({
    packages: [acmePlatformPackage({
      binaryEpilogues: [{
        id: "drain-runtime",
        path: "acme_platform::drain_runtime",
        requiredCrate: "acme_platform",
      }],
    })],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "inactive_epilogue_proof" },
    },
    files: {
      "index.ts": `
import type { Store } from "@acme/platform";

export function accept(_value: Store): void {}
export function main(): void {}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/main.rs"), /drain_runtime/u);
  assert.doesNotMatch(artifactText(result, "Cargo.toml"), /acme_platform/u);
});

test("a fallible provider epilogue makes binary completion explicitly fallible", () => {
  const { result } = compileRust({
    packages: [acmeFilesPackage({
      binaryEpilogues: [{
        id: "drain-runtime",
        path: "acme_files::drain_runtime_fallible",
        requiredCrate: "acme_files",
        isFallible: true,
        errorBoundary: "provider-native",
      }],
    })],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "fallible_epilogue_proof" },
    },
    files: {
      "index.ts": `
import { readText } from "@acme/files";

export function main(): void {
  readText("unused");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const main = artifactText(result, "src/main.rs");
  assert.match(main, /fn main\(\) -> tsonic_rust_runtime::TsonicResult<\(\)>/u);
  assert.match(
    main,
    /acme_files::drain_runtime_fallible\(\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?;/u,
  );
  assert.match(main, /Ok\(\(\)\)/u);
  validateGeneratedProject("fallible-epilogue-proof", result.artifacts);
});
