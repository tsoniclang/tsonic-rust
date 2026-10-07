import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

function compile(source) {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 4).map(diagnostic => `${diagnostic.code}: ${diagnostic.message.slice(0, 256)}`).join("\n"));
  const text = artifactText(result, "src/index.rs");
  assert.equal(typeof text === "string" && text.length > 0, true, "actual generated source");
  assert.doesNotMatch(text, /FrozenObject|ConditionalWeakTable|downcast|transmute|unsafe\s*\{/u);
  return { result, text };
}

function nativeInitialization(result) {
  return artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : "";
}

const positiveSources = [
  ["inferred broad aliases", `
    type Token = object;
    function retain(value: Token): Token { return value; }
    export function run(): boolean {
      const first: Token = {};
      const alias = retain(first);
      const frozen = Object.freeze(first);
      const retained = retain(frozen);
      const direct = {};
      const directFrozen = Object.freeze(direct);
      return frozen === alias && retained === first && directFrozen === direct &&
        Object.isFrozen(frozen) && Object.isFrozen(retained) && Object.isFrozen(directFrozen);
    }
  `],
  ["private parameters and returns", `
    import type { int64 } from "@tsonic/core/types.js";
    function retain(value: object): object { return value; }
    function frozen(value: object): object { return Object.freeze(value); }
    export function run(): boolean {
      const first: object = {};
      const alias = retain(first);
      const direct = {};
      const directAlias: object = direct;
      const before = Object.isFrozen(alias) || Object.isFrozen(directAlias);
      const frozenFirst = frozen(first);
      const frozenDirect = Object.freeze(direct);
      const second: object = Object.freeze({});
      const wide: int64 = 9007199254740993n;
      return !before && frozenFirst === alias && frozenDirect === directAlias &&
        Object.isFrozen(alias) && Object.isFrozen(directAlias) && Object.isFrozen(direct) &&
        Object.isFrozen(second) && second !== first && wide === 9007199254740993n;
    }
  `],
  ["array tuple and record origins", `
    function retain(value: object): object { return value; }
    export function run(): boolean {
      const first: object = {};
      const slots: object[] = [first];
      const pair: [object, object] = [first, {}];
      const holder: { value: object } = { value: first };
      const alias = retain(slots[0]);
      if (Object.isFrozen(alias)) return false;
      Object.freeze(holder.value);
      return Object.isFrozen(pair[0]) && Object.isFrozen(slots[0]) &&
        Object.isFrozen(alias) && !Object.isFrozen(pair[1]);
    }
  `],
  ["private callbacks and receivers", `
    export interface Holder { value: object; }
    class LocalHolder { value: object = {}; }
    const record: Holder = { value: {} };
    const instance = new LocalHolder();
    const retain = (value: object): object => value;
    export function run(): boolean {
      const recordAlias = retain(record.value);
      const instanceAlias = retain(instance.value);
      if (Object.isFrozen(recordAlias) || Object.isFrozen(instanceAlias)) return false;
      Object.freeze(recordAlias);
      Object.freeze(instanceAlias);
      return Object.isFrozen(record.value) && Object.isFrozen(instance.value) &&
        recordAlias === record.value && instanceAlias === instance.value;
    }
  `],
  ["exported readonly token", `
    export const token: object = {};
    export function run(): boolean {
      if (Object.isFrozen(token)) return false;
      return Object.freeze(token) === token && Object.isFrozen(token);
    }
  `],
  ["selected operation aliases", `
    const freeze = Object.freeze;
    const frozen = Object.isFrozen;
    export function run(): boolean {
      const token: object = {};
      const retained = freeze(token);
      return retained === token && frozen(retained) && frozen(token);
    }
  `],
  ["exported readonly empty members", `
    export class Holder { readonly value: object = {}; }
    export const record: { readonly value: object } = { value: {} };
    export function run(): boolean {
      const holder = new Holder();
      const alias = holder.value;
      if (Object.isFrozen(alias) || Object.isFrozen(record.value)) return false;
      Object.freeze(holder.value);
      Object.freeze(record.value);
      return Object.isFrozen(alias) && Object.isFrozen(record.value) && alias === holder.value;
    }
  `],
  ["refined absence and single evaluation", `
    function retain(value: object | null): object | null { return value; }
    export function run(): boolean {
      let calls = 0;
      const first: object = {};
      function selected(): object { calls += 1; return first; }
      const absent = retain(null);
      const present = retain(first);
      if (absent !== null || present === null) return false;
      if (Object.freeze(selected()) !== present || calls !== 1) return false;
      return Object.isFrozen(present) && calls === 1;
    }
  `],
];

for (const [name, source] of positiveSources) {
  test(`broad empty freeze preserves native identity through ${name}`, { timeout: 300_000 }, () => {
    const { result, text } = compile(source);
    assert.match(text, /JsValue::(?:freeze_object_state|object_state_is_frozen)/u);
    const root = writeGeneratedProject(`frozen-empty-${name}`, result.artifacts);
    const index = join(root, "src/index.rs");
    writeFileSync(index, `${readFileSync(index, "utf8")}\n#[test]\nfn original_authored_identity_and_state() { ${nativeInitialization(result)} assert!(run()); }\n`);
    runCargo(root, ["test", "--offline", "--", "--test-threads=1"]);
  });
}

test("cross-file object signatures retain exact closed EmptyObject origins", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: {
    "retain.ts": `export type Token = object; export function retain(value: Token): Token { return value; }`,
    "index.ts": `import { retain } from "./retain.js"; import type { Token } from "./retain.js";
      export function run(): boolean { const value: Token = {}; const alias = retain(value);
        Object.freeze(value); return alias === value && Object.isFrozen(alias); }`,
  } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 4).map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
  const root = writeGeneratedProject("frozen-empty-cross-file", result.artifacts);
  const index = join(root, "src/index.rs");
  writeFileSync(index, `${readFileSync(index, "utf8")}\n#[test]\nfn cross_file_identity() { ${nativeInitialization(result)} assert!(run()); }\n`);
  runCargo(root, ["test", "--offline", "--", "--test-threads=1"]);
});

test("repeated broad freeze has exactly the handwritten native allocation and bytes", { timeout: 300_000 }, () => {
  const { result } = compile(`
    function retain(value: object): object { return value; }
    export function aliases(): boolean {
      const first: object = {};
      const alias = retain(first);
      const frozen = Object.freeze(first);
      return frozen === alias && first === alias && Object.isFrozen(first) && Object.isFrozen(alias);
    }
    export function run(): boolean {
      const value: object = {};
      let frozen = false;
      for (let iteration = 0; iteration < 20000; iteration += 1) {
        Object.freeze(value);
        frozen = Object.isFrozen(value);
      }
      return frozen;
    }
  `);
  const root = writeGeneratedProject("frozen-empty-allocation", result.artifacts);
  const index = join(root, "src/index.rs");
  writeFileSync(index, `${readFileSync(index, "utf8")}
#[cfg(test)]
mod freeze_costs {
    use super::*;
    use tsonic_rust_runtime as rt;
    ${nativeOwnershipCostSupport}
    fn handwritten() -> bool {
        let value = rt::EmptyObject::new();
        let mut frozen = false;
        for _iteration in 0..20000 {
            rt::freeze_object(&value);
            frozen = rt::object_is_frozen(&value);
        }
        frozen
    }
    fn handwritten_aliases() -> bool {
        let first = rt::EmptyObject::new();
        let alias = first.clone();
        let frozen = rt::freeze_object(&first);
        frozen == alias && first == alias && rt::object_is_frozen(&first) && rt::object_is_frozen(&alias)
    }
    #[test]
    fn original_broad_carrier_adds_no_allocation_or_bytes() {
        ${nativeInitialization(result)}
        let (generated, generated_cost) = measure(run);
        let (native, native_cost) = measure(handwritten);
        assert!(generated);
        assert!(native);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        assert_eq!(generated_cost.reallocations, 0);
        assert_eq!(std::mem::size_of::<rt::TsValue>(), 32);
        assert_eq!(std::mem::size_of::<tsonic_rust_js::JsValue>(), 40);
    }
    #[test]
    fn original_retain_aliases_match_native_identity_and_lifetime_cost() {
        ${nativeInitialization(result)}
        let (generated, generated_cost) = measure(aliases);
        let (native, native_cost) = measure(handwritten_aliases);
        assert!(generated);
        assert!(native);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        assert_eq!(generated_cost.reallocations, 0);
        assert_eq!(generated_cost.deallocations, 1);
    }
}
`);
  runCargo(root, ["test", "--offline", "--", "--test-threads=1"]);
});

const openSources = [
  ["private erased record", `function freeze(value: object): object { return Object.freeze(value); } export function example(): object { return freeze({ count: 1 }); }`],
  ["exported opaque object", `export function freeze(value: object): object { return Object.freeze(value); }`],
  ["exported opaque object with local empty call", `export function freeze(value: object): object { return Object.freeze(value); } export function run(): object { return freeze({}); }`],
  ["exported alias", `type Open = object; export function freeze(value: Open): Open { const alias = value; return Object.freeze(alias); }`],
  ["nested opaque member", `export function frozen(value: { inner: object }): boolean { return Object.isFrozen(value.inner); }`],
  ["mixed allocation origins", `function freeze(value: object): object { return Object.freeze(value); } export function run(flag: boolean): object { return freeze(flag ? {} : { count: 1 }); }`],
  ["unknown array element", `export function run(values: object[]): boolean { return Object.isFrozen(values[0]); }`],
  ["mixed array origins", `export function run(): boolean { const values: object[] = [{}, { count: 1 }]; return Object.isFrozen(values[0]); }`],
  ["mutable record origin", `export function run(flag: boolean): boolean { let value: object = {}; if (flag) value = { count: 1 }; return Object.isFrozen(value); }`],
  ["exported generic unknown with local empty call", `export function freeze<T extends object>(value: T): T { return Object.freeze(value); } export function run(): object { return freeze({}); }`],
  ["escaping private callable", `function freeze(value: object): object { return Object.freeze(value); } export function retained(): (value: object) => object { freeze({}); return freeze; }`],
  ["exported mutable token", `export let value: object = {}; export function frozen(): boolean { return Object.isFrozen(value); }`],
  ["exported mutable class field", `export class Holder { value: object = {}; frozen(): boolean { return Object.isFrozen(this.value); } }`],
  ["exported mutable record field", `export const holder: { value: object } = { value: {} }; export function frozen(): boolean { return Object.isFrozen(holder.value); }`],
  ["exported mutable record alias", `const holder: { value: object } = { value: {} }; export const retained = holder; export function frozen(): boolean { return Object.isFrozen(holder.value); }`],
  ["returned mutable record storage", `const holder: { value: object } = { value: {} }; export function retained(): { value: object } { return holder; } export function frozen(): boolean { return Object.isFrozen(holder.value); }`],
  ["private class instance returned through exported function", `class Holder { value: object = {}; } const holder = new Holder(); export function retained(): Holder { return holder; } export function frozen(): boolean { return Object.isFrozen(holder.value); }`],
  ["exported readonly member with writable descendants", `export const holder: { readonly values: object[] } = { values: [{}] }; export function frozen(): boolean { return Object.isFrozen(holder.values[0]); }`],
  ["returned readonly member with writable descendants", `const holder: { readonly nested: { value: object } } = { nested: { value: {} } }; export function retained(): { readonly nested: { value: object } } { return holder; } export function frozen(): boolean { return Object.isFrozen(holder.nested.value); }`],
  ["exported mutable tuple element", `export const pair: [object, object] = [{}, {}]; export function frozen(): boolean { return Object.isFrozen(pair[0]); }`],
  ["exported mutable array element", `export const values: object[] = [{}]; export function frozen(): boolean { return Object.isFrozen(values[0]); }`],
  ["opaque checked callback can mutate an exposed record", `export function frozen(mutate: (holder: { value: object }) => void): boolean { const holder: { value: object } = { value: {} }; mutate(holder); return Object.isFrozen(holder.value); }`],
  ["opaque checked callback can mutate writable readonly-member descendants", `export function frozen(mutate: (holder: { readonly values: object[] }) => void): boolean { const holder: { readonly values: object[] } = { values: [{}] }; mutate(holder); return Object.isFrozen(holder.values[0]); }`],
  ["unrelated freeze spelling", `const unrelated = { freeze(value: object): object { return { count: 1 }; } }; export function frozen(): boolean { const first: object = {}; return Object.isFrozen(unrelated.freeze(first)); }`],
  ["shadowed Object spelling", `const inspect = Object.isFrozen; export function frozen(): boolean { const Object = { freeze(value: object): object { return { count: 1 }; } }; const first: object = {}; return inspect(Object.freeze(first)); }`],
  ["generic replacement result is not an input identity promise", `function replace<T extends object>(value: T, replacement: T): T { return replacement; } export function frozen(): boolean { const first: object = {}; const second: object = { count: 1 }; return Object.isFrozen(replace(first, second)); }`],
];

for (const [name, source] of openSources) {
  test(`open empty freeze domain rejects ${name} before publication`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SELECTED_OPERATION_UNSUPPORTED"), true,
      `exact operation owner rejection: ${result.diagnostics.slice(0, 3).map(diagnostic => diagnostic.code).join(",")}`);
    assert.equal(result.artifacts.length, 0, "rejected source publishes no artifacts");
  });
}

test("unrefined absence does not bypass checked non-absent source input", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts":
    `export function run(value: object | null): object | null { return Object.freeze(value); }` } }),
    /TypeScript diagnostics:[\s\S]*TS2345[\s\S]*null/u);
});
