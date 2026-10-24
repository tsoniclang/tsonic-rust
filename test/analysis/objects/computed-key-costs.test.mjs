import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const sourceText = `
const globalKey = "value";
const numericKey = 1;
enum Key { Value = 1 }
interface Holder { value: number; }
interface NumericHolder { 1: number; }
export function make(value: number): Holder { return { value }; }
export function makeNumeric(value: number): NumericHolder { return { 1: value }; }
export function globalRead(object: Holder): number { return object[globalKey]; }
export function localRead(object: Holder, key: "value"): number { return object[key]; }
export function numericRead(object: NumericHolder): number { return object[numericKey]; }
export function enumRead(object: NumericHolder): number { return object[Key.Value]; }
export function consumeGlobal(): string { return globalKey; }
class Effects {
  sequence: number = 0;
  receiver(value: number): Holder { this.sequence = this.sequence * 10 + 1; return { value }; }
  key(): "value" { this.sequence = this.sequence * 10 + 2; return "value"; }
  get field(): "value" { this.sequence = this.sequence * 10 + 3; return "value"; }
}
export function effectObservations(): boolean {
  const state = new Effects();
  const first = state.receiver(23)[state.key()];
  const second = state.receiver(24)[state.field];
  return first === 23 && second === 24 && state.sequence === 1213;
}
`;

function checkedKeyReads(program) {
  const { ast } = program.source;
  const reads = [];
  const pending = program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts"));
  while (pending.length !== 0) {
    const node = pending.pop();
    if (ast.is.IsElementAccessExpression(node)) {
      const fact = program.records.computedMember.get(node);
      assert.equal(fact !== undefined, true, "an actual computed key has its canonical evaluation record");
      reads.push({ fact, ownership: program.ownership.reads.get(fact.key) });
    }
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return reads;
}

for (const surfaces of [[], ["js"]]) {
  test(`Rust ${surfaces[0] ?? "native"} computed keys retain physical views, effects and native costs`, { timeout: 300_000 }, () => {
    const compiled = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib", crateName: "computed_key_costs" } },
      files: { "index.ts": sourceText } });
    assert.equal(compiled.result.diagnostics.length, 0,
      compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
    assert.equal(compiled.result.program !== undefined && compiled.result.plan !== undefined, true, "actual source reaches sealed native planning");
    const program = compiled.result.program;
    const reads = checkedKeyReads(program);
    const { ast } = program.source;
    for (const name of ["globalRead", "localRead", "numericRead", "enumRead"]) {
      const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
        ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
      assert.equal(declaration !== undefined, true, `${name}: the original checked source function is retained`);
      const parameters = sourceCallableValueParameters(ast, declaration, program.source.semantics.forNode(declaration));
      assert.equal(parameters !== undefined && parameters.length > 0, true, `${name}: the original object parameter is checked`);
      const abi = program.records.sourceParameterAbi.get(parameters[0]);
      assert.equal(abi?.mode, "ref", `${name}: a nonretaining object read keeps its native shared input`);
      assert.equal(abi?.parameterCarrier.kind === "reference" && !abi.parameterCarrier.mutable &&
        rustTargetTypeRefEquals(abi.parameterCarrier.referent, abi.valueCarrier), true,
      `${name}: the shared input refers to the exact owned source carrier`);
    }
    const global = reads.find(read => ast.is.IsIdentifier(read.fact.key) && ast.text(read.fact.key) === "globalKey");
    const local = reads.find(read => ast.is.IsIdentifier(read.fact.key) && ast.text(read.fact.key) === "key");
    assert.equal(global !== undefined && local !== undefined, true, "global native-const and local checked keys both participate");
    const declaration = program.records.sourceBinding.get(global.fact.key)?.sourceDeclaration;
    const module = declaration === undefined ? undefined : program.records.moduleBinding.get(declaration);
    assert.equal(module?.storage, "native-const", "the global view comes from selected physical constant storage");
    assert.equal(global.ownership?.source.kind, "borrow", "the exact evaluated global key is non-consuming");
    assert.equal(global.ownership?.source.kind === "borrow" && !global.ownership.source.mutable, true, "the shared view is immutable");
    assert.equal(global.ownership?.sharedReference, true, "the native-const key already is a physical str reference");
    assert.equal(local.ownership?.source.kind, "borrow", "local evaluated keys retain their native borrow");
    assert.equal(reads.filter(read => read.fact.evaluateKey).length, 6, "all key reads, calls and getter evaluations remain present");
    const output = artifactText(compiled.result, "src/index.rs");
    assert.equal(/const globalKey: &str = "value";/u.test(output), true, "the selected physical global ABI is a static str view");
    const root = writeGeneratedProject(`computed-key-costs-${surfaces[0] ?? "native"}`, compiled.result.artifacts);
    appendFileSync(join(root, "src/index.rs"), `
#[cfg(test)]
mod computed_key_costs {
    use super::*;
    ${nativeOwnershipCostSupport(root)}

    struct NativeHolder {
        value: f64,
    }

    fn native_read(object: NativeHolder, key: &str) -> f64 {
        let _member_key = std::hint::black_box(key);
        object.value
    }

    fn native_local_read(object: NativeHolder, key: String) -> f64 {
        let _member_key = std::hint::black_box(&key);
        object.value
    }

    struct NativeEffects {
        sequence: usize,
    }

    impl NativeEffects {
        fn receiver(&mut self, value: f64) -> NativeHolder {
            self.sequence = self.sequence * 10 + 1;
            NativeHolder { value }
        }

        fn key(&mut self, digit: usize) -> String {
            self.sequence = self.sequence * 10 + digit;
            String::from("value")
        }
    }

    fn native_effect_observations() -> bool {
        let mut state = NativeEffects { sequence: 0 };
        let first = state.receiver(23.0);
        let _first_key = state.key(2);
        let second = state.receiver(24.0);
        let _second_key = state.key(3);
        first.value == 23.0 && second.value == 24.0 && state.sequence == 1213
    }

    #[test]
    fn source_key_views_match_native_counts_and_consuming_inverses() {
        let input = make(std::hint::black_box(23.0));
        let local_input = make(23.0);
        let numeric_input = makeNumeric(23.0);
        let enum_input = makeNumeric(23.0);
        let native_input = NativeHolder { value: 23.0 };
        let native_local_input = NativeHolder { value: 23.0 };
        let actual_key = String::from("value");
        let native_key = String::from("value");
        let (actual, actual_cost) = measure(|| globalRead(std::hint::black_box(&input)));
        let (expected, expected_cost) = measure(|| native_read(std::hint::black_box(native_input), "value"));
        assert_eq!(actual, expected);
        assert_eq!(actual_cost, expected_cost);
        assert_eq!(actual_cost, Cost::default());
        let (actual, actual_cost) = measure(|| localRead(&local_input, std::hint::black_box(actual_key)));
        let (expected, expected_cost) = measure(|| native_local_read(native_local_input, std::hint::black_box(native_key)));
        assert_eq!(actual, expected);
        assert_eq!(actual_cost, expected_cost);
        assert_eq!(actual_cost.allocations, 0);
        assert_eq!(actual_cost.allocated_bytes, 0);
        assert_eq!(actual_cost.reallocations, 0);
        let (actual, cost) = measure(|| numericRead(&numeric_input));
        assert_eq!(actual, expected);
        assert_eq!(cost, Cost::default());
        let (actual, cost) = measure(|| enumRead(&enum_input));
        assert_eq!(actual, expected);
        assert_eq!(cost, Cost::default());
        let (owned, actual_cost) = measure(consumeGlobal);
        let (native_owned, expected_cost) = measure(|| String::from(std::hint::black_box("value")));
        assert_eq!(owned, native_owned);
        assert_eq!(actual_cost, expected_cost);
        assert_eq!(actual_cost.allocations, 1);
        assert_eq!(actual_cost.allocated_bytes, 5);
        assert_eq!(actual_cost.reallocations, 0);
        assert_eq!(effectObservations(), native_effect_observations());
        assert!(native_effect_observations());
    }
}
`);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(root, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
  });
}

