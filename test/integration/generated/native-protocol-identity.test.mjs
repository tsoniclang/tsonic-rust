import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourcePackageGraphFixture } from "../../../../tsonic/test/fixtures/source-package-graph.mjs";

test("cross-file quantified forwarding shares one native protocol and executes without dispatch allocation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_protocol_identity" } },
    files: {
      "retain.ts": `
        export type Identity = <Value>(value: Value) => Value;
        export function retain(callback: Identity): Identity { return callback; }
      `,
      "invoke.ts": `
        import { retain } from "./retain.js";
        import type { Identity } from "./retain.js";
        export function invoke(callback: Identity): number { return retain(callback)<number>(7); }
      `,
      "index.ts": `
        import { invoke } from "./invoke.js";
        export function main(): void {
          const identity = <Value>(value: Value): Value => value;
          if (invoke(identity) !== 7) throw new Error("forward");
        }
      main();
      `,
    },
  });
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.equal([...generated.matchAll(/pub trait NativeCallable_[a-f\d]+/gu)].length, 1);
  assert.equal([...generated.matchAll(/impl (?:[A-Za-z_][A-Za-z_\d]*::)*NativeCallable_[a-f\d]+ for/gu)].length, 1);
  assert.doesNotMatch(generated, /Box<|dyn /u);
  validateGeneratedProject("native_protocol_identity", result.artifacts, { run: true });
});

test("quantified callbacks forward across independent source crates with their exact producer implementation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_protocol_packages" } },
    sourcePackages: sourcePackageGraphFixture(["index.ts"], {
      "@acme/retain": { files: ["index.ts"], dependencies: [] },
      "@acme/invoke": { files: ["index.ts"], dependencies: ["@acme/retain"] },
    }),
    files: {
      "node_modules/@acme/retain/package.json": JSON.stringify({ name: "@acme/retain", version: "1.0.0", type: "module", exports: { ".": "./index.ts" } }),
      "node_modules/@acme/retain/index.ts": `
        export type Identity = <Value>(value: Value) => Value;
        export function retain(callback: Identity): Identity { return callback; }
      `,
      "node_modules/@acme/invoke/package.json": JSON.stringify({ name: "@acme/invoke", version: "1.0.0", type: "module", exports: { ".": "./index.ts" } }),
      "node_modules/@acme/invoke/index.ts": `
        import { retain } from "@acme/retain";
        import type { Identity } from "@acme/retain";
        export function invoke(callback: Identity): number { return retain(callback)<number>(7); }
      `,
      "index.ts": `
        import { invoke } from "@acme/invoke";
        export function main(): void {
          const identity = <Value>(value: Value): Value => value;
          if (invoke(identity) !== 7) throw new Error("cross-package");
        }
      main();
      `,
    },
  });
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.equal([...generated.matchAll(/pub trait NativeCallable_[a-f\d]+/gu)].length, 2);
  assert.doesNotMatch(generated, /Box<|dyn /u);
  validateGeneratedProject("native_protocol_packages", result.artifacts, { run: true });
});

test("a downstream protocol implements its imported physical producer without a reverse crate dependency", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_protocol_imported" } },
    sourcePackages: sourcePackageGraphFixture(["index.ts"], {
      "@acme/producer": { files: ["index.ts"], dependencies: [] },
    }),
    files: {
      "node_modules/@acme/producer/package.json": JSON.stringify({ name: "@acme/producer", version: "1.0.0", type: "module", exports: { ".": "./index.ts" } }),
      "node_modules/@acme/producer/index.ts": `
        export type Identity = <Value>(value: Value) => Value;
        export function make(): Identity { return <Value>(value: Value): Value => value; }
      `,
      "index.ts": `
        import { make } from "@acme/producer";
        import type { Identity } from "@acme/producer";
        function invoke(callback: Identity): number { return callback<number>(11); }
        export function main(): void {
          if (invoke(make()) !== 11) throw new Error("imported producer");
        }
      main();
      `,
    },
  });
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.equal([...generated.matchAll(/pub trait NativeCallable_[a-f\d]+/gu)].length, 1);
  assert.doesNotMatch(generated, /Box<|dyn /u);
  validateGeneratedProject("native_protocol_imported", result.artifacts, { run: true });
});
