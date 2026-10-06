import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const source = `
import { ref } from "@tsonic/rust/lang.js";
class Borrowed<T> { constructor(readonly seed: T) {} }
class Aliased<T> { constructor(readonly seed: T) {} }
class Copied<T> {
  constructor(readonly seed: T) {}
  copy(): T[] { return [this.seed, this.seed]; }
}
export function duplicate<T>(seed: T): Aliased<T>[] {
  const value = new Aliased(seed);
  return [value, value];
}
export function copies<T>(seed: T): T[] { return new Copied(seed).copy(); }
export function borrowed<T>(seed: T): void {
  const value = new Borrowed(seed);
  const view = ref(value.seed);
  void view;
}
export function main(): void {
  const values = duplicate(3);
  const copied = copies(5);
  if (values[0] !== values[1] || copied[0] !== 5 || copied[1] !== 5) throw new Error("native class storage");
}
`;

test("generic class contracts distinguish shared ownership from actual field Clone obligations", () => {
  const { program } = analyzeRust({ files: { "index.ts": source } });
  const aliased = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Aliased");
  const copied = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Copied");
  const borrowed = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Borrowed");
  assert.equal(aliased?.kind, "shared-immutable");
  assert.equal(copied?.kind, "value");
  assert.equal(borrowed?.kind, "value");
  assert.deepEqual(program.declarationGenericRequirements.contractFor(aliased.definition.declaration)?.typeParameters.map(value => value.requirements), [[]]);
  assert.deepEqual(program.declarationGenericRequirements.contractFor(copied.definition.declaration)?.typeParameters.map(value => value.requirements), [["clone"]]);
  assert.deepEqual(program.declarationGenericRequirements.contractFor(borrowed.definition.declaration)?.typeParameters.map(value => value.requirements), [[]]);
});

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`native generic classes preserve non-Clone aliases and exact required payload copies in ${profile}`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(value => value.message.slice(0, 256)).join("\n"));
      const directory = writeGeneratedProject(`generic-class-native-storage-${profile}`, result.artifacts);
      runCargo(directory, ["generate-lockfile", "--offline"]);
      runCargo(directory, ["fmt", "--all", "--check"]);
      appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod native_storage {
    use super::*;
    use std::cell::Cell;

    struct Payload<'a>(&'a Cell<usize>);
    impl Drop for Payload<'_> {
        fn drop(&mut self) { self.0.set(self.0.get() + 1); }
    }

    struct CopyCount<'a>(&'a Cell<usize>);
    impl Clone for CopyCount<'_> {
        fn clone(&self) -> Self {
            self.0.set(self.0.get() + 1);
            Self(self.0)
        }
    }

    #[test]
    fn aliases_retain_one_non_clone_payload() {
        let drops = Cell::new(0);
        let ${profile === "native" ? "mut " : ""}values = duplicate(Payload(&drops));
        assert_eq!(values.len(), 2);
        assert_eq!(drops.get(), 0);
        drop(values.pop());
        assert_eq!(drops.get(), 0);
        drop(values);
        assert_eq!(drops.get(), 1);
    }

    #[test]
    fn borrowing_does_not_require_clone() {
        let drops = Cell::new(0);
        borrowed(Payload(&drops));
        assert_eq!(drops.get(), 1);
    }

    #[test]
    fn owned_field_reads_use_the_required_clone_contract() {
        let clone_count = Cell::new(0);
        let values = copies(CopyCount(&clone_count));
        assert_eq!(values.len(), 2);
        assert_eq!(clone_count.get(), 2);
    }
}
`);
      runCargo(directory, ["fmt", "--all"]);
      runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
      runCargo(directory, ["run", "--release", "--locked", "--offline"]);
    });
}
