import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

const syncResource = `
export class Resource {
  constructor() {}
  [Symbol.dispose](): void {}
}
`;

test("using lowers exact disposal around the remaining lexical scope", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${syncResource}
export function run(): void {
  using resource = new Resource();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let resource: Resource = Resource::new\(\);/u);
  assert.match(source, /rt::Completion<\(\)>/u);
  assert.match(source, /resource\.dispose\(\);/u);
  validateGeneratedProject("resource-management-normal", result.artifacts);
});

test("using preserves return break and continue through cleanup", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
${syncResource}
export function choose(value: int32): int32 {
  using resource = new Resource();
  if (value > 0) return value;
  return 0;
}

export function loopValues(): void {
  for (let index: int32 = 0; index < 3; index++) {
    using resource = new Resource();
    if (index === 0) continue;
    break;
  }
}

export function doValues(): void {
  let index: int32 = 0;
  do {
    using resource = new Resource();
    index++;
    if (index < 2) continue;
    break;
  } while (index < 3);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Completion::Return\(value\)/u);
  assert.match(source, /rt::Completion::Continue\(0\)/u);
  assert.match(source, /rt::Completion::Break\(0\)/u);
  assert.match(source, /continue '__tsonic_loop/u);
  assert.match(source, /break '__tsonic_loop/u);
  assert.equal([...source.matchAll(/rt::Completion::Continue\(0\)/gu)].length >= 4, true);
  assert.match(source, /if index >= 3 \{/u);
  validateGeneratedProject("resource-management-control-flow", result.artifacts);
});

test("multiple using declarations dispose in reverse lexical order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${syncResource}
export function run(): void {
  using first = new Resource();
  using second = new Resource();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(source.indexOf("second.dispose()") < source.indexOf("first.dispose()"), true);
  validateGeneratedProject("resource-management-reverse-order", result.artifacts);
});

test("await using awaits exact asynchronous disposal", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class AsyncResource {
  constructor() {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

export async function run(): Promise<void> {
  await using resource = new AsyncResource();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /async fn dispose_async\(&self\)/u);
  assert.match(source, /resource\.dispose_async\(\)\.await/u);
  validateGeneratedProject("resource-management-async", result.artifacts);
});

test("resource bindings follow authored lexical block scope", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${syncResource}
class AsyncResource {
  constructor() {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

export async function run(fail: boolean): Promise<void> {
  {
    using resource = new Resource();
  }
  {
    await using resource = new AsyncResource();
  }
  if (fail) {
    throw new Error("failure");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal([...source.matchAll(/let resource: (?:Resource|AsyncResource) =/gu)].length, 2);
  assert.match(source, /resource\.dispose\(\)/u);
  assert.match(source, /resource\.dispose_async\(\)\.await/u);
  assert.match(source, /let __tsonic_resource_flow(?:_\d+)?: rt::TsonicResult<rt::Completion<\(\)>> =\n\s+Ok\(rt::Completion::Normal\);/u);
  validateGeneratedProject("resource-management-lexical-scope", result.artifacts);
});

test("using skips null resources through the exact Option carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${syncResource}
export function run(resource: Resource | null): void {
  using active = resource;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /if let Some\(__tsonic_resource\) = active\.as_ref\(\)/u);
  assert.match(source, /__tsonic_resource\.dispose\(\)/u);
  validateGeneratedProject("resource-management-null", result.artifacts);
});

test("fallible disposal composes body and cleanup errors through the runtime", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class FailingResource {
  constructor() {}
  [Symbol.dispose](): void {
    throw new Error("cleanup");
  }
}

export function run(): void {
  using resource = new FailingResource();
  throw new Error("body");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::TsonicResult<rt::Completion<\(\)>>/u);
  assert.match(source, /rt::finish_resource/u);
  assert.match(source, /resource\.dispose\(\)\?/u);
  validateGeneratedProject("resource-management-failures", result.artifacts);
});

test("using in a for initializer disposes after the complete loop", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${syncResource}
export function run(): void {
  for (using resource = new Resource(); false;) {}
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(source.indexOf("Resource::new()") < source.indexOf("while false"), true);
  assert.equal(source.indexOf("while false") < source.indexOf("resource.dispose()"), true);
  validateGeneratedProject("resource-management-for-initializer", result.artifacts);
});

test("using in a for-of binding disposes once per iteration", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${syncResource}
function observe(resource: Resource): Resource {
  return resource;
}
export function run(): void {
  const resources: Resource[] = [new Resource()];
  for (using resource of resources) {
    observe(resource);
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /for resource in rt::iter_cloned\(&resources\)/u);
  assert.match(source, /resource\.dispose\(\)/u);
  validateGeneratedProject("resource-management-for-of", result.artifacts);
});

test("await using in for-await-of disposes each async resource", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class AsyncResource {
  constructor() {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

async function* resources(): AsyncGenerator<AsyncResource, void, void> {
  yield new AsyncResource();
}

export async function run(): Promise<void> {
  for await (await using resource of resources()) {}
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /while let Some\(resource\) = .*next_yield\(\)\.await/u);
  assert.match(source, /resource\.dispose_async\(\)\.await/u);
  validateGeneratedProject("resource-management-for-await", result.artifacts);
});
