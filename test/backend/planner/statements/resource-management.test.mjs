import assert from "node:assert/strict";
import { test } from "node:test";

import { acmeTestingPackage, artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

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
  assert.match(
    source,
    /let dispatch_receiver(?:_\d+)? = resource;[\s\S]*dispatch_receiver(?:_\d+)?\s*\.dispatch\s*\.clone\(\)\s*\.dispatch_resource_dispose\(\)/u,
  );
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
  assert.match(source, /continue 'loop/u);
  assert.match(source, /break 'loop/u);
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
  assert.deepEqual(
    [...source.matchAll(/let dispatch_receiver(?:_\d+)? = (second|first);/gu)]
      .map((match) => match[1]),
    ["second", "first"],
  );
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
  assert.match(source, /let dispatch_receiver(?:_\d+)? = resource;[\s\S]*dispatch_resource_dispose\(\)/u);
  assert.match(source, /resource\.dispose_async\(\)\.await/u);
  assert.match(source, /let resource_flow(?:_\d+)?: rt::TsonicResult<rt::Completion<\(\)>> =\s+Ok\(rt::Completion::Normal\);/u);
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
  assert.match(source, /if let Some\(resource_2\) = active\.as_ref\(\)/u);
  assert.match(source, /let dispatch_receiver(?:_\d+)? = resource_2;[\s\S]*dispatch_resource_dispose\(\)/u);
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
  assert.equal(source.indexOf("while false") < source.indexOf("dispatch_resource_dispose()"), true);
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
  assert.match(source, /let dispatch_receiver(?:_\d+)? = resource;[\s\S]*dispatch_resource_dispose\(\)/u);
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

test("using remains live across sync generator suspension and disposes on every completion", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generator_resource" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let disposed: int32 = 0;

class Resource {
  constructor() {}
  [Symbol.dispose](): void {
    disposed += 1;
  }
}

function* values(): Generator<int32, int32, int32> {
  using resource = new Resource();
  const next: int32 = yield 7;
  return next;
}

export function main(): void {
  const returned = values();
  check(disposed === 0);
  returned.next();
  check(disposed === 0);
  const returnedResult = returned.return(11);
  check(returnedResult.done === true);
  check(disposed === 1);

  const completed = values();
  completed.next();
  const completedResult = completed.next(9);
  check(completedResult.done === true);
  check(disposed === 2);

  const thrown = values();
  thrown.next();
  try {
    thrown.throw(new Error("stop"));
  } catch {}
  check(disposed === 3);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /generator(?:_\d+)?\.yield_value\(7\)\.await/u);
  assert.match(source, /resource\.dispose\(\)/u);
  assert.match(source, /rt::finish_resource/u);
  assert.equal(validateGeneratedProject("generator-resource", result.artifacts, { run: true }).status, 0);
});

test("await using remains live across async generator suspension and awaits cleanup", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "async_generator_resource" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let disposed: int32 = 0;

class AsyncResource {
  constructor() {}
  async [Symbol.asyncDispose](): Promise<void> {
    disposed += 1;
  }
}

async function* values(): AsyncGenerator<int32, int32, int32> {
  await using resource = new AsyncResource();
  const next: int32 = yield 7;
  return next;
}

export async function main(): Promise<void> {
  const returned = values();
  await returned.next();
  check(disposed === 0);
  const returnedResult = await returned.return(11);
  check(returnedResult.done === true);
  check(disposed === 1);

  const thrown = values();
  await thrown.next();
  try {
    await thrown.throw(new Error("stop"));
  } catch {}
  check(disposed === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /generator(?:_\d+)?\.yield_value\(7\)\.await/u);
  assert.match(source, /resource\.dispose_async\(\)\.await/u);
  assert.match(source, /rt::finish_resource/u);
  assert.equal(validateGeneratedProject("async-generator-resource", result.artifacts, { run: true }).status, 0);
});
