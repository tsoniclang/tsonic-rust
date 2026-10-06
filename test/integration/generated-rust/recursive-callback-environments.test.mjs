import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const source = `
class Holder<T> {
  constructor(readonly seed: T) {}
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped<U>(seed: U): (count: number) => number {
  const value = new Holder(seed);
  const original = value.recurse;
  value.rebind();
  return original;
}
export function main(): void {
  const callback = escaped(7);
  if (callback(0) !== 1 || callback(8) !== 2) throw new Error("class callback generic environment");
}
`;

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`class callback factories preserve native non-Clone borrowed inputs without retaining unused fields in ${profile}`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
        files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
      const directory = writeGeneratedProject(`recursive-callback-environment-${profile}`, result.artifacts);
      runCargo(directory, ["generate-lockfile", "--offline"]);
      runCargo(directory, ["fmt", "--all", "--check"]);
      appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod native_environment {
    use super::*;
    ${nativeOwnershipCostSupport}

    struct Payload<'a>(&'a Cell<usize>);
    impl Drop for Payload<'_> {
        fn drop(&mut self) { self.0.set(self.0.get() + 1); }
    }

    #[test]
    fn borrowed_non_clone_input_has_native_drop_and_frame_cost() {
        let drops = Cell::new(0);
        let (callback, created) = measure(|| escaped(Payload(&drops)));
        assert_eq!(drops.get(), 1, "an uncaptured value field drops with its native class value");
        assert_eq!(created.allocations, 1);
        assert_eq!(created.deallocations, 0);
        assert_eq!(created.reallocations, 0);
        let (_, warmed) = measure(|| {
            for _ in 0..32 {
                assert_eq!(callback.call((0.0,)).unwrap(), 1.0);
                assert_eq!(callback.call((8.0,)).unwrap(), 2.0);
            }
        });
        assert_eq!(warmed, Cost::default());
        let (alias, cloned) = measure(|| callback.clone());
        assert_eq!(cloned, Cost::default());
        assert!(callback == alias);
        drop(alias);
        let (_, released) = measure(|| drop(callback));
        assert_eq!(released.allocations, 0);
        assert_eq!(released.deallocations, 1);
        assert_eq!(released.deallocated_bytes, created.allocated_bytes);
        assert_eq!(drops.get(), 1);
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
