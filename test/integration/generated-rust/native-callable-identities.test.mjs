import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const source = `
  type Identity = <Value>(value: Value) => Value;
  function make(callback: () => number): Identity {
    return <Value>(value: Value): Value => { callback(); return value; };
  }
  function compare(left: () => number, right: () => number): boolean {
    const first = make(left);
    const alias = first;
    const second = make(right);
    let order = 0;
    if ((order = order * 10 + 1, first) !== (order = order * 10 + 2, alias)) return false;
    if (order !== 12 || first !== alias || first === second) return false;
    return first<number>(7) === 7 && alias<string>("native") === "native" && second<number>(9) === 9;
  }
  export function main(): void {
    const left = () => 1;
    const right = () => 2;
    if (!compare(left, right)) throw new Error("native activation identity or evaluation changed");
  }
main();
`;

for (const surfaces of [[], ["js"]]) {
  test(`native callable identity preserves typed captures, distinct activations and operand order (${surfaces[0] ?? "native"})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
        files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
      const generated = artifactText(result, "src/index.rs");
      assert.match(generated, /core::ptr::addr_eq/u);
      assert.equal(generated.match(/\bfirst\.clone\(\)/gu)?.length ?? 0, 1,
        "the authored alias clones once; shared sequence-tail comparisons never clone");
      assert.doesNotMatch(generated, /transmute|as \*const|Box<dyn|unreachable_unchecked/u);
      validateGeneratedProject(`native-activation-identity-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    });
}

test("native identity checks heterogeneous captures without error bounds or additional allocations", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "lib", crateName: "native_callable_identity" } },
    files: { "index.ts": `
      type Identity = <Value>(value: Value) => Value;
      export function make(callback: () => number): Identity {
        return <Value>(value: Value): Value => { callback(); return value; };
      }
      export function compare(left: () => number, right: () => number): boolean {
        const first = make(left);
        const alias = first;
        const second = make(right);
        return first === alias && first !== second;
      }
    ` },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const directory = writeGeneratedProject("native-identity-heterogeneous-cost", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/identity.rs"), `${nativeOwnershipCostSupport(directory)}
#[derive(Debug)]
struct NoCloneError;
struct OwnedError;
struct BorrowedError<'owner>(&'owner NoCloneError);
impl tsonic_rust_runtime::CallableImplementation<()> for OwnedError {
    type Output = Result<f64, NoCloneError>;
    fn invoke(&self, (): ()) -> Self::Output { Err(NoCloneError) }
}
impl<'owner> tsonic_rust_runtime::CallableImplementation<()> for BorrowedError<'owner> {
    type Output = Result<f64, &'owner NoCloneError>;
    fn invoke(&self, (): ()) -> Self::Output { Err(self.0) }
}
#[test]
fn native_identity_retains_typed_errors_and_existing_storage_cost() {
    let original = NoCloneError;
    let first = native_callable_identity::index::make(OwnedError);
    let borrowed = native_callable_identity::index::make(BorrowedError(&original));
    let actual: Result<i64, &NoCloneError> = borrowed.call(9007199254740993_i64);
    assert!(std::ptr::eq(actual.unwrap_err(), &original));
    let owned: Result<i64, NoCloneError> = first.call(9007199254740993_i64);
    assert!(owned.is_err());
    let alias = first.clone();
    let (result, cost) = measure(|| {
        for _ in 0..10000 {
            assert!(first == alias);
            assert!(native_callable_identity::index::compare(OwnedError, BorrowedError(&original)));
        }
        true
    });
    assert!(result);
    assert_eq!(cost.allocations, 20000);
    assert_eq!(cost.deallocations, 20000);
    assert_eq!(cost.reallocations, 0);
    assert_eq!(cost.allocated_bytes, cost.deallocated_bytes);
    let (_, same_identity_cost) = measure(|| {
        for _ in 0..10000 { assert!(first == alias); }
    });
    assert_eq!(same_identity_cost, Cost::default());
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt"]);
  runCargo(directory, ["fmt", "--check"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline", "--test", "identity"]);
});

test("joined stored-family Eq preserves cross-variant aliases and rejects distinct activations", { timeout: 300_000 }, () => {
  const options = { surfaces: [],
    target: { id: "rust", options: { outputType: "lib", crateName: "native_joined_identity" } },
    files: { "index.ts": `
      type Identity = <Value>(value: Value) => Value;
      export function make(callback: () => number): Identity {
        return <Value>(value: Value): Value => { callback(); return value; };
      }
      export function choose(left: () => number, right: () => number, select: boolean): Identity {
        return select ? make(left) : make(right);
      }
      export function compare(left: () => number, right: () => number): boolean {
        const original = choose(left, right, true);
        const alias = original;
        return original === alias;
      }
    ` },
  };
  const { program } = analyzeRust(options);
  const physical = program.callableValues.generic.physical;
  const single = physical.definitions().find(definition => definition.members.length === 1);
  const joined = physical.definitions().find(definition => definition.members.length === 2);
  assert.equal(single !== undefined && joined !== undefined, true);
  assert.equal(joined.members[0].implementation === joined.members[1].implementation, true);
  assert.equal(program.callableValues.genericIdentities.forDefinition(joined).pairs.length, 4);
  const { result } = compileRust(options);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const generated = artifactText(result, "src/index.rs");
  assert.equal(generated.includes(joined.targetName) && generated.includes(single.targetName), true,
    "the native proof names come from exact owned physical definitions");
  const directory = writeGeneratedProject("native-joined-identity-cost", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/identity.rs"), `${nativeOwnershipCostSupport(directory)}
struct Callback;
impl tsonic_rust_runtime::CallableImplementation<()> for Callback {
    type Output = Result<f64, core::convert::Infallible>;
    fn invoke(&self, (): ()) -> Self::Output { Ok(7.0) }
}
#[test]
fn same_allocation_across_native_variants_keeps_identity() {
    use native_joined_identity::index::{${single.targetName}, ${joined.targetName}};
    let ${single.targetName}::${single.members[0].variantName}(original) = native_joined_identity::index::make(Callback);
    let ${single.targetName}::${single.members[0].variantName}(fresh) = native_joined_identity::index::make(Callback);
    let left: ${joined.targetName}<Callback, Callback> = ${joined.targetName}::${joined.members[0].variantName}(original.clone());
    let alias = ${joined.targetName}::${joined.members[1].variantName}(original);
    let other = ${joined.targetName}::${joined.members[1].variantName}(fresh);
    let (_, cost) = measure(|| {
        for _ in 0..10000 {
            assert!(left == alias);
            assert!(left != other);
            assert!(left == left.clone());
        }
    });
    assert_eq!(cost, Cost::default());
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt"]);
  runCargo(directory, ["fmt", "--check"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline", "--test", "identity"]);
});
