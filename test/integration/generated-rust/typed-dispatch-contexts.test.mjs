import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { dispatchProviderPackage } from "../../helpers/rust-session/provider-dispatch-contexts.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(name, source, options = {}) {
  const { result } = compileRust({
    packages: [dispatchProviderPackage(options)], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": source },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject(`typed-dispatch-${name}`, result.artifacts, { run: true });
  return result;
}

test("provider selection without dispatch demand initializes and emits no root", { timeout: 300_000 }, () => {
  const result = compile("no-demand", `
    import { constructions } from "@acme/dispatch";
    export function main(): void { if (constructions() !== 0) throw new Error("unexpected root"); }
  `);
  assert.doesNotMatch(result.artifacts.map(artifact => artifact.text).join("\n"), /__tsonic_dispatch_|static dispatch_root_\d/u);
});

test("lazy runtime-domain roots preserve Error identity and uninvoked tasks", { timeout: 300_000 }, () => {
  const result = compile("runtime-error", `
    import { constructions, enqueue, poll } from "@acme/dispatch";
    export function main(): void {
      if (constructions() !== 0) throw new Error("eager dispatch");
      const failure = new Error("exact queued failure");
      let observed = false;
      enqueue(() => { throw failure; });
      enqueue(() => { observed = true; });
      if (constructions() !== 1) throw new Error("duplicate dispatch");
      let caught = false;
      try { poll(); } catch (error) { if (error !== failure) throw new Error("identity lost"); caught = true; }
      if (!caught || observed) throw new Error("failure consumed later work");
      poll();
      if (!observed || constructions() !== 1) throw new Error("later work lost");
    }
  `);
  const support = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
    .map(artifact => artifact.text).join("\n");
  assert.match(support, /acme_dispatch::Dispatch<tsonic_rust_runtime::TsonicError>/u);
  assert.doesNotMatch(support, /ERR_TSONIC_CALLBACK|to_string\(\)|ModuleCell<acme_dispatch/u);
});

test("component roots retain nominal failures and exact native int64 payloads", { timeout: 300_000 }, () => {
  const result = compile("nominal-error", `
    import type { int64 } from "@tsonic/core/types.js";
    import { enqueue, poll } from "@acme/dispatch";
    class Failure { constructor(public readonly value: int64) {} }
    export function main(): void {
      const failure = new Failure(9007199254740993n);
      enqueue(() => { throw failure; });
      let caught = false;
      try { poll(); } catch (error) { if (error !== failure) throw new Error("nominal identity lost"); caught = true; }
      if (!caught || failure.value !== 9007199254740993n) throw new Error("payload rounded");
    }
  `);
  const support = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
    .map(artifact => artifact.text).join("\n");
  assert.match(support, /acme_dispatch::Dispatch<crate::\w+::TsonicError>/u);
  assert.doesNotMatch(support, /ERR_TSONIC_CALLBACK|u64_to_f64|i64_to_f64/u);
});

test("composed contexts share one physical root and retain reentrant work for the next turn", { timeout: 300_000 }, () => {
  const result = compile("composed", `
    import { constructions, enqueue, poll } from "@acme/dispatch";
    export function main(): void {
      let observed = false;
      enqueue(() => { enqueue(() => { observed = true; }); });
      poll();
      if (observed || constructions() !== 1) throw new Error("composition or turn boundary");
      poll();
      if (!observed || constructions() !== 1) throw new Error("reentrant work lost");
    }
  `, { composed: true });
  const support = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
    .map(artifact => artifact.text).join("\n");
  assert.match(support, /acme_dispatch::Parent<tsonic_rust_runtime::TsonicError>/u);
  assert.doesNotMatch(support, /__tsonic_dispatch_|static dispatch_root_2|static \w+: acme_dispatch::Dispatch</u);
  assert.match(artifactText(result, "src/index.rs"), /dispatch_root(?:_\d+)?\.child\(\)/u);
});

test("authored fallible argument evaluation precedes native root initialization", { timeout: 300_000 }, () => {
  compile("argument-failure", `
    import { constructions, enqueue } from "@acme/dispatch";
    function rejected(): () => void { throw new Error("argument failed"); }
    export function main(): void {
      let caught = false;
      try { enqueue(rejected()); } catch (error) { caught = true; }
      if (!caught || constructions() !== 0) throw new Error("native root changed source evaluation");
    }
  `);
});

test("receiver dispatch inputs retain native mutation source order and callback failure identity", { timeout: 300_000 }, () => {
  const result = compile("receiver-context", `
    import { constructions, poll, Receiver } from "@acme/dispatch";
    export function main(): void {
      const receiver = new Receiver();
      const failure = new Error("receiver callback");
      let order = 0;
      function right(): number { order = order * 10 + 2; return 2; }
      function left(): number { order = order * 10 + 1; return 1; }
      receiver.enqueue(right(), left(), () => { throw failure; });
      if (order !== 21 || receiver.value !== 12 || constructions() !== 1) {
        throw new Error("receiver or argument correspondence");
      }
      let caught = false;
      try { poll(); } catch (error) {
        if (error !== failure) throw new Error("receiver callback identity");
        caught = true;
      }
      if (!caught) throw new Error("receiver callback lost");
    }
  `);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /\.enqueue\(/u);
  assert.doesNotMatch(source, /ERR_TSONIC_CALLBACK|to_string\(\)/u);
});
