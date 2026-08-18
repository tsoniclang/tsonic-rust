import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmePlatformPackage,
  acmeTelemetryCapability,
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("optional property reads lower through exact selected receiver and result carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_property" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

interface Box { value: int32 }

function read(item: Box | undefined): int32 | undefined {
  return item?.value;
}

function length(value: string | undefined): int32 | undefined {
  return value?.length;
}

export function main(): void {
  check((read(undefined) ?? -1) === -1);
  check((read({ value: 7 }) ?? -1) === 7);
  check((length(undefined) ?? -1) === -1);
  check((length("rust") ?? -1) === 4);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /item\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver/u);
  assert.match(source, /value\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver/u);
  validateGeneratedProject("optional-property", result.artifacts, { run: true });
});

test("optional element reads preserve lazy index evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_element" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

let calls: int32 = 0;

function index(): int32 {
  calls += 1;
  return 0;
}

function first(values: int32[] | undefined): int32 | undefined {
  return values?.[index()];
}

export function main(): void {
  check((first(undefined) ?? -1) === -1);
  check(calls === 0);
  check((first([9]) ?? -1) === 9);
  check(calls === 1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\s*\.as_ref\(\)\s*\.and_then\(\s*\|optional_receiver/u);
  assert.doesNotMatch(source, /\.transpose\(\)|\.flatten\(\)/u);
  assert.match(source, /index\(\)/u);
  validateGeneratedProject("optional-element", result.artifacts, { run: true });
});

test("optional provider properties retain provider identity inside the Option lane", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmePlatformPackage()],
    files: {
      "index.ts": `
import { Store } from "@acme/platform";
import type { int32 } from "@tsonic/core/types.js";

export function count(store: Store | undefined): int32 | undefined {
  return store?.count;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /store\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver.*optional_receiver\.count/su,
  );
  validateGeneratedProject("optional-provider-property", result.artifacts);
});

test("optional provider methods retain exact provider member identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [acmeTelemetryCapability()],
    files: {
      "index.ts": `
import { Meter } from "telemetry";
import type { int32 } from "@tsonic/core/types.js";

export function total(meter: Meter | undefined): int32 | undefined {
  return meter?.total();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /meter\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver.*optional_receiver\.total\(\)/su,
  );
  validateGeneratedProject("optional-provider-method", result.artifacts);
});

test("optional syntax on a checker-proven non-null receiver stays direct", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function length(value: string): int32 {
  return value?.length;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /\.map\(/u);
  validateGeneratedProject("optional-non-null", result.artifacts);
});

test("optional project-source method calls preserve the selected method result", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_source_method" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

class Counter {
  current(): int32 {
    return 9;
  }
}

function read(counter: Counter | undefined): int32 | undefined {
  return counter?.current();
}

export function main(): void {
  check((read(undefined) ?? -1) === -1);
  check((read(new Counter()) ?? -1) === 9);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /counter\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver.*optional_receiver\.current\(\)/su,
  );
  validateGeneratedProject("optional-source-method", result.artifacts, { run: true });
});

test("optional JavaScript methods evaluate arguments only after the receiver guard", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_js_method" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

let calls: int32 = 0;

function needle(): string {
  calls += 1;
  return "u";
}

function includes(value: string | undefined): boolean | undefined {
  return value?.includes(needle());
}

export function main(): void {
  check((includes(undefined) ?? false) === false);
  check(calls === 0);
  check(includes("rust") ?? false);
  check(calls === 1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /value\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver/u);
  assert.match(
    source,
    /js_string::includes_from_start\(optional_receiver, &needle\(\)\)/u,
  );
  validateGeneratedProject("optional-js-method", result.artifacts, { run: true });
});
