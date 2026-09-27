import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("local class scopes preserve repeated authored names through native construction and cross-file returns", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_local_types" } },
    files: {
      "values.ts": `
        import type { int32 } from "@tsonic/core/types.js";
        export class Entry { value: int32 = 0; }
        export function first() {
          class Entry {
            private value: int32 = 3;
            readValue(): int32 { return this.value; }
          }
          return new Entry();
        }
        export function second() {
          class Entry { value: int32 = 7; }
          return new Entry();
        }
        export function generic<Value>(input: Value) {
          return class Entry {
            readValue(): Value { return input; }
          };
        }
      `,
      "index.ts": `
        import { check } from "@acme/testing";
        import { Entry, first, second, generic } from "./values.js";
        export function main(): void {
          check(new Entry().value === 0);
          check(first().readValue() === 3);
          check(second().value === 7);
          const Value = generic("retained");
          check(new Value().readValue() === "retained");
        }
      `,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const sources = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
    .map(artifact => artifact.text).join("\n");
  assert.equal([...sources.matchAll(/\bstruct Entry\b/g)].length, 4);
  assert.match(sources, /\bfn readValue\b/);
  assert.doesNotMatch(sources, /\b(?:struct (?:FirstEntry|SecondEntry|GenericEntry)|fn read_value)\b/);
  const native = validateGeneratedProject("authored-local-types", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stderr || native.stdout);
});
