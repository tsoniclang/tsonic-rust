import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { recursiveCallbackProtocolCases } from "../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const lexicalProof = `
    #[test]
    fn physical_location_is_allocated_once_and_matches_native_pointer_cost() {
        let native = rt::Location::allocate(3.0);
        let (_, native_cost) = measure(|| {
            for _ in 0..32 {
                let first = native.into_fallible::<rt::TsonicError>();
                let second = native.into_fallible::<rt::TsonicError>();
                assert!(rt::Location::same(Some(&first), Some(&second)));
                second.try_store(first.try_load().unwrap() + 1.0).unwrap();
            }
        });
        for _ in 0..16 {
            let (callback, created) = measure(|| create(3.0));
            assert_eq!(created.allocations, 2, "one physical location and one native callback activation");
            assert_eq!(created.reallocations, 0);
            assert_eq!(created.deallocations, 0);
            let (alias, retained) = measure(|| callback.clone());
            assert_eq!(retained, Cost::default());
            let (_, invoked) = measure(|| {
                for index in 0..32 {
                    assert_eq!(callback.call((0.0,)).unwrap(), 4.0 + f64::from(index));
                }
            });
            assert_eq!(invoked, native_cost, "frame addressing adds no allocation or error-adapter layer over native Location");
            let (_, first_drop) = measure(|| drop(callback));
            assert_eq!(first_drop, Cost::default());
            assert_eq!(alias.call((1.0,)).unwrap(), 37.0);
            let (_, final_drop) = measure(|| drop(alias));
            assert_eq!(final_drop.allocations, 0);
            assert_eq!(final_drop.reallocations, 0);
            assert_eq!(created.allocations, final_drop.deallocations);
            assert_eq!(created.allocated_bytes, final_drop.deallocated_bytes);
        }
    }
`;

const classProof = profile => `
    #[test]
    fn projected_pointer_matches_native_cost_and_retains_exactly_one_activation() {
        fn native_pointer(owner: &rt::ObjectHandle<f64>) -> rt::Location<f64, rt::TsonicError> {
            let reader = owner.clone();
            let writer = owner.clone();
            rt::Location::try_bind_projected(owner.clone(),
                rt::location::LocationSegment::Member(String::from("seed")),
                move || Ok(reader.with(|value| *value)),
                move |next| { writer.with_mut(|value| *value = next); Ok(()) })
        }
        let native = rt::ObjectHandle::new(3.0);
        let (native_first, native_created) = measure(|| native_pointer(&native));
        let (_, native_warmed) = measure(|| drop(native_pointer(&native)));
        drop(native_first);
        for _ in 0..16 {
            let (callback, created) = measure(|| create(3.0)${profile === "js" ? ".unwrap()" : ""});
            assert_eq!(created.allocations, 1, "only the native shared class activation");
            assert_eq!(created.deallocations, 0);
            assert_eq!(created.reallocations, 0);
            let (pointer, addressed) = measure(|| callback.call((0.0,)).unwrap());
            assert_eq!(addressed.allocations, native_created.allocations);
            assert_eq!(addressed.reallocations, native_created.reallocations);
            assert_eq!(addressed.deallocations, native_created.deallocations);
            let (_, warmed) = measure(|| {
                let alias = callback.call((8.0,)).unwrap();
                assert!(rt::Location::same(Some(&pointer), Some(&alias)));
                alias.try_store(7.0).unwrap();
                assert_eq!(pointer.try_load().unwrap(), 7.0);
            });
            assert_eq!(warmed.allocations, native_warmed.allocations);
            assert_eq!(warmed.reallocations, native_warmed.reallocations);
            assert_eq!(warmed.deallocations, native_warmed.deallocations);
            assert_eq!(warmed.allocated_bytes, warmed.deallocated_bytes);
            let (_, callback_drop) = measure(|| drop(callback));
            assert_eq!(callback_drop, Cost::default(), "pointer retains its actual owner after the callback disappears");
            let (_, live) = measure(|| {
                pointer.try_store(9.0).unwrap();
                assert_eq!(pointer.try_load().unwrap(), 9.0);
            });
            assert_eq!(live, Cost::default(), "native reads and writes allocate nothing");
            let (_, final_drop) = measure(|| drop(pointer));
            assert_eq!(final_drop.allocations, 0);
            assert_eq!(final_drop.reallocations, 0);
            assert_eq!(created.allocations + addressed.allocations, addressed.deallocations + final_drop.deallocations);
            assert_eq!(created.allocated_bytes + addressed.allocated_bytes, addressed.deallocated_bytes + final_drop.deallocated_bytes);
        }
    }
`;

for (const [name, selectedProof] of [["addressed-lexical-frame", () => lexicalProof], ["addressed-class-pointer-return", classProof]]) {
  for (const surfaces of [[], ["js"]]) {
    const profile = surfaces[0] ?? "native";
    test(`${name} preserves native pointer allocation and complete owner release in ${profile}`, { timeout: 300_000 }, () => {
      const source = recursiveCallbackProtocolCases.find(current => current.name === name).source;
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
      const directory = writeGeneratedProject(`recursive-address-cost-${name}-${profile}`, result.artifacts);
      const proof = selectedProof(profile);
      runCargo(directory, ["generate-lockfile", "--offline"]);
      runCargo(directory, ["fmt", "--all", "--check"]);
      appendFileSync(join(directory, "src/index.rs"), `\n#[cfg(test)]\nmod address_cost {\nuse super::*;\n${nativeOwnershipCostSupport}\n${proof}\n}\n`);
      runCargo(directory, ["fmt", "--all"]);
      runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
      runCargo(directory, ["run", "--release", "--locked", "--offline"]);
    });
  }
}
