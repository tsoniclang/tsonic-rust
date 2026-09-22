import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const files = {
  "model.ts": `
    export abstract class Base {
      abstract readonly token: object;
      abstract equal(other: Base | undefined): boolean;
    }
    export interface Factory<Value> { new(value: Value): Base; }
    export function factory<Value>(token: object, same: (left: Value, right: Value) => boolean): Factory<Value> {
      class Adapter extends Base {
        readonly token = token;
        value: Value;
        constructor(value: Value) { super(); this.value = value; }
        static accepts(value: Base | undefined): value is Adapter {
          return value !== undefined && value.token === token;
        }
        equal(other: Base | undefined): boolean {
          return Adapter.accepts(other) && same(this.value, other.value);
        }
      }
      return Adapter;
    }
  `,
  "index.ts": `
    import { factory } from "./model.js";
    class DownstreamValue {
      text: string;
      constructor(text: string) { this.text = text; }
    }
    export function main(): void {
      const leftType = factory<DownstreamValue>(Object.freeze({}), (left, right) => left.text === right.text);
      const rightType = factory<DownstreamValue>(Object.freeze({}), (left, right) => left.text === right.text);
      const numberType = factory<number>(Object.freeze({}), (left, right) => left === right);
      const payload = new DownstreamValue("native");
      const first = new leftType(payload);
      const alias = first;
      const second = new leftType(new DownstreamValue("native"));
      const unrelated = new rightType(new DownstreamValue("native"));
      const numeric = new numberType(7);
      if (!first.equal(second) || !alias.equal(first)) throw new Error("generic recovery");
      if (first.equal(unrelated) || first.equal(numeric) || first.equal(undefined)) throw new Error("nominal identity");
      payload.text = "changed";
      if (first.equal(second) || !alias.equal(first)) throw new Error("aliasing");
    }
  `,
};

test("generic nominal recovery preserves exact instances across a forward-only package graph", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], files,
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_nominal_projections" } },
    sourcePackages: {
      fingerprint: "generic-nominal-forward-only", rootPackageId: "app",
      packages: [
        { id: "model", name: "model", packageRoot: "/src/model", sourceRoot: "/src",
          sourceFiles: ["/src/model.ts"], dependencies: [], componentId: "model",
          exports: [{ specifier: "model", sourceFile: "/src/model.ts" }] },
        { id: "app", name: "app", packageRoot: "/src", sourceRoot: "/src",
          sourceFiles: ["/src/index.ts"], dependencies: ["model"], componentId: "app",
          exports: [{ specifier: "app", sourceFile: "/src/index.ts" }] },
      ],
      components: [
        { id: "model", packages: ["model"], dependencies: [] },
        { id: "app", packages: ["app"], dependencies: ["model"] },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const rust = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
    .map(artifact => artifact.text).join("\n");
  assert.match(rust, /downcast_mut::<Option</);
  assert.doesNotMatch(rust, /downcast_unchecked|transmute/);
  validateGeneratedProject("generic_nominal_projections", result.artifacts, { run: true });
});

test("checked generic nominal recovery includes the exact ancestor view of a more-derived root", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin", crateName: "generic_ancestor_projection" } },
    files: { "index.ts": `
      abstract class Base { abstract kind(): number; }
      class Box<Value> extends Base {
        value: Value;
        constructor(value: Value) { super(); this.value = value; }
        kind(): number { return 1; }
        static accepts<Value>(value: Base): value is Box<Value> { return value.kind() === 1; }
      }
      class Child<Value> extends Box<Value> { extra = 2; }
      class Other extends Base { kind(): number { return 0; } }
      function read<Value>(value: Base, absent: Value): Value {
        if (Box.accepts<Value>(value)) return value.value;
        return absent;
      }
      export function main(): void {
        const child = new Child<string>("retained");
        const base: Base = child;
        if (read<string>(base, "absent") !== "retained") throw new Error("ancestor");
        child.value = "changed";
        if (read<string>(base, "absent") !== "changed" || child.extra !== 2) throw new Error("identity");
        if (read<string>(new Other(), "absent") !== "absent") throw new Error("unrelated");
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generic_ancestor_projection", result.artifacts, { run: true });
});
