import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustRuntimeUnionContract, rustRuntimeUnionProjection } from "../../../dist/target-model/types/carriers/runtime-unions.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustJsIntlGroupingTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { planRustFlowReadProjection } from "../../../dist/backend/planner/expressions/flow-reads.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("Intl exact integer, optional precision and grouping contracts execute in Rust", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "intl_contract" } },
    files: { "index.ts": `
      import { check } from "@acme/testing";
      import type { int64, uint64, int128, uint128 } from "@tsonic/core/types.js";
      export function main(): void {
        const signed: int64 = 9007199254740993n;
        const unsigned: uint64 = 18446744073709551615n;
        const formatter = new Intl.NumberFormat("en", { maximumSignificantDigits: 3 });
        const options = formatter.resolvedOptions();
        const grouping = options.useGrouping;
        check(typeof grouping === "string" && grouping === "auto");
        check(options.minimumFractionDigits === undefined);
        check(options.maximumFractionDigits === undefined);
        const digits = options.maximumSignificantDigits;
        check(digits !== undefined && digits === 3);
        const plain = new Intl.NumberFormat("en", { useGrouping: false });
        const absentDigits = plain.resolvedOptions().maximumSignificantDigits;
        const absentCurrency = plain.resolvedOptions().currency;
        check(absentDigits === undefined && absentCurrency === undefined);
        const currency = new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).resolvedOptions().currency;
        check(currency !== undefined && currency === "USD");
        const disabled = plain.resolvedOptions().useGrouping;
        check(typeof disabled !== "string" && disabled === false);
        check(false === disabled && "auto" === grouping);
        check(grouping === formatter.resolvedOptions().useGrouping);
        check(grouping !== disabled);
        check(formatter.format(1234.5) === "1,230");
        check(plain.format(signed) === "9007199254740993");
        check(plain.format(unsigned) === "18446744073709551615");
        const parts = plain.formatToParts(unsigned);
        check(parts[0].value === "18446744073709551615");
        check(signed.toLocaleString("en", { useGrouping: false }) === "9007199254740993");
        check(unsigned.toLocaleString() === "18,446,744,073,709,551,615");
        check(unsigned.toLocaleString(undefined) === "18,446,744,073,709,551,615");
        check(signed.toLocaleString(undefined, { useGrouping: false }) === "9007199254740993");
        check(signed.toLocaleString(["en"], { useGrouping: false }) === "9007199254740993");
        check(signed.toLocaleString("en", undefined) === "9,007,199,254,740,993");
        const wide: int128 = -170141183460469231731687303715884105728n;
        const wideUnsigned: uint128 = 340282366920938463463374607431768211455n;
        const arbitrary: bigint = 340282366920938463463374607431768211456123n;
        check(plain.format(wide) === "-170141183460469231731687303715884105728");
        check(plain.format(wideUnsigned) === "340282366920938463463374607431768211455");
        check(plain.format(arbitrary) === "340282366920938463463374607431768211456123");
        check(plain.formatToParts(arbitrary)[0].value === "340282366920938463463374607431768211456123");
        check(arbitrary.toLocaleString("en", { useGrouping: false }) === "340282366920938463463374607431768211456123");
        check(wide.toLocaleString("en", { useGrouping: false }) === "-170141183460469231731687303715884105728");
        check(arbitrary === 340282366920938463463374607431768211456123n);
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("intl-number-contract", result.artifacts, { run: true });
});

test("native result union correspondence rejects mismatched carriers", () => {
  const string = rustStringTargetType();
  const boolean = rustSourcePrimitiveTargetType("bool");
  const source = { kind: "target-named", id: rustJsIntlGroupingTargetId };
  assert.equal(rustRuntimeUnionProjection(source, string), "as_string");
  assert.equal(rustRuntimeUnionProjection(source, boolean), "as_bool");
  assert.equal(rustRuntimeUnionProjection(source, rustSourcePrimitiveTargetType("int32")), undefined);
  assert.equal(rustRuntimeUnionContract({ ...source, id: "unrelated" }), undefined);
  assert.equal(rustRuntimeUnionContract({ ...source, genericArguments: [{ kind: "type", type: string }] }), undefined);
});

test("native result union planning rejects mutated projection evidence", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 8 });
  const sourceFile = fakeSourceFile({ text: "grouping", statements: [node] });
  const source = { kind: "target-named", id: rustJsIntlGroupingTargetId };
  const selected = rustStringTargetType();
  const context = {
    input: { program: {
      source: { ast: fakeAstReader([sourceFile]) },
      facts: { getRuntimeCarrierFact: () => ({ carrier: source }) },
    } },
    sourceFile,
    diagnostics: [],
  };
  const expression = { kind: "path", path: "grouping" };
  const fact = { kind: "runtime-union", sourceCarrier: source, selectedCarrier: selected, method: "as_string" };
  assert.deepEqual(planRustFlowReadProjection(node, expression, fact, context), {
    kind: "method-call", receiver: expression, method: "as_string", args: [],
  });
  for (const mutation of [
    { ...fact, method: "as_bool" },
    { ...fact, sourceCarrier: selected },
    { ...fact, selectedCarrier: rustSourcePrimitiveTargetType("bool") },
  ]) {
    context.diagnostics.length = 0;
    assert.equal(planRustFlowReadProjection(node, expression, mutation, context), undefined);
    assert.equal(context.diagnostics.length, 1);
    assert.equal(context.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
  }
});
