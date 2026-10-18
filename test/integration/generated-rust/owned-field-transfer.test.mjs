import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertNoNativeCalls, nativeFunction } from "../../helpers/native-ast.mjs";

const functions = ["direct", "parenthesized", "asserted", "satisfies", "nonNull", "constructed"];
const source = `
class Slot<T> { constructor(readonly item: T) {} }
export function direct<T>(seed: T): T { const value = new Slot(seed); return value.item; }
export function parenthesized<T>(seed: T): T { const value = new Slot(seed); return (((value))).item; }
export function asserted<T>(seed: T): T { const value = new Slot(seed); return (value as Slot<T>).item; }
export function satisfies<T>(seed: T): T { const value = new Slot(seed); return (value satisfies Slot<T>).item; }
export function nonNull<T>(seed: T): T { const value = new Slot(seed); return value!.item; }
export function constructed<T>(seed: T): T { return new Slot(seed).item; }
`;

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`owned value-class field transfers preserve native no-Clone and exact cost contracts in ${profile}`,
    { timeout: 300_000 }, () => {
      const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
      const representation = program.objectRepresentations.representations.find(entry => entry.definition.sourceName === "Slot");
      assert.equal(representation?.kind, "value", "the source proves a value carrier before any move-cost assertion");
      const { result } = compileRust({ surfaces, files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(issue => String(issue.message).slice(0, 256)).join("\n"));
      for (const name of functions) {
        const callable = nativeFunction(result, name);
        const parameter = callable.generics.parameters.find(entry => entry.kind === "type" && entry.name === "T");
        assert.equal(parameter !== undefined, true, "the generic payload parameter is preserved");
        assert.equal(parameter.bounds.length, 0, `${name} adds no payload trait bound`);
        assertNoNativeCalls(callable, ["clone", "rt::ObjectRef::new", "Box::new"], `${name} transfers the native field directly`);
      }
      const directory = writeGeneratedProject(`owned-field-transfer-${profile}`, result.artifacts);
      appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod field_transfer {
    use super::*;
    use std::cell::Cell;

    struct NoClone<'a>(&'a Cell<usize>);
    impl Drop for NoClone<'_> {
        fn drop(&mut self) { self.0.set(self.0.get() + 1); }
    }

    struct Counted<'a> { clones: &'a Cell<usize>, drops: &'a Cell<usize> }
    impl Clone for Counted<'_> {
        fn clone(&self) -> Self {
            self.clones.set(self.clones.get() + 1);
            Self { clones: self.clones, drops: self.drops }
        }
    }
    impl Drop for Counted<'_> {
        fn drop(&mut self) { self.drops.set(self.drops.get() + 1); }
    }

    fn handwritten<T>(seed: T) -> T {
        struct NativeSlot<T> { item: T }
        let value = NativeSlot { item: seed };
        value.item
    }

    #[test]
    fn non_clone_payloads_are_moved_once() {
        ${functions.map(name => `let drops = Cell::new(0);
        let value = ${name}(NoClone(&drops));
        assert_eq!(drops.get(), 0);
        drop(value);
        assert_eq!(drops.get(), 1);`).join("\n        ")}
    }

    #[test]
    fn clones_and_drops_equal_handwritten_field_moves() {
        ${[...functions, "handwritten"].map(name => `let clones = Cell::new(0);
        let drops = Cell::new(0);
        let value = ${name}(Counted { clones: &clones, drops: &drops });
        assert_eq!(clones.get(), 0);
        assert_eq!(drops.get(), 0);
        drop(value);
        assert_eq!(clones.get(), 0);
        assert_eq!(drops.get(), 1);`).join("\n        ")}
    }
}
`);
      runCargo(directory, ["generate-lockfile", "--offline"]);
      runCargo(directory, ["fmt"]);
      runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
    });
}
