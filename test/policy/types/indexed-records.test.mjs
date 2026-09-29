import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustRecordCarrierValue, rustRecordTargetType } from "../../../dist/target-model/types/carriers/records.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { selectRustBinaryOperator } from "../../../dist/policy/operations/operators/rules.js";

test("indexed record carriers retain exact key, value and native contracts", () => {
  const key = rustStringTargetType();
  const value = rustSourcePrimitiveTargetType("uint64");
  const carrier = rustRecordTargetType(key, value);
  assert.deepEqual(rustRecordCarrierValue(carrier), { key, value });
  assert.equal(rustRecordCarrierValue({ ...carrier, value: { ...carrier.value, id: "unrelated.Record" } }), undefined);
  assert.equal(rustRecordCarrierValue({ ...carrier, value: { ...carrier.value, path: "other::Record" } }), undefined);
  assert.equal(rustRecordCarrierValue({ ...carrier, value: { ...carrier.value, traits: { implementations: [] } } }), undefined);
});

test("native equality uses exact PartialEq contracts, not record or wrapper names", () => {
  const without = rustNamedTargetType("fixture.Value", "fixture::Value");
  const comparable = rustNamedTargetType("fixture.Value", "fixture::Value", [], [], {
    implementations: [{ traitPath: "core::cmp::PartialEq", requirements: [] }],
  });
  assert.equal(selectRustBinaryOperator("===", without, without), undefined);
  assert.equal(selectRustBinaryOperator("===", comparable, without), undefined);
  assert.equal(selectRustBinaryOperator("===", comparable, comparable)?.rustOperator, "==");
  assert.equal(selectRustBinaryOperator("!==", comparable, comparable)?.rustOperator, "!=");
});

for (const surfaces of [[], ["js"]]) {
  test(`indexed record aliasing, absence and native integers on ${surfaces.length === 0 ? "native" : "js"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "indexed_records" } },
      files: { "records.ts": `
        export function read<Value>(record: Record<string, Value | undefined>, key: string): Value | undefined {
          return record[key];
        }
        export function one<Value>(value: Value): Record<string, Value> { return { first: value }; }
        export function copy<Value>(record: Record<string, Value>): Record<string, Value> { return { ...record }; }
        export function change(record: Record<string, string | undefined>): string {
          record["present"] = "after";
          return "last";
        }
      `, "index.ts": `
        import { check } from "@acme/testing";
        import type { uint64 } from "@tsonic/core/types.js";
        import { read, one, copy, change } from "./records.js";
        export function main(): void {
          const values: Record<string, uint64> = { first: 9007199254740993n };
          const alias = values;
          alias["second"] = 9007199254740994n;
          values["first"] += 1n;
          const previous = values["first"]++;
          check(previous === 9007199254740994n && alias["first"] === 9007199254740995n);
          check(values["second"] === 9007199254740994n);
          const optional: Record<string, string | undefined> = { present: "yes", absent: undefined };
          check(read(optional, "present") === "yes");
          check(read(optional, "absent") === undefined && read(optional, "missing") === undefined);
          const snapshot: Record<string, string | undefined> = { ...optional, present: "changed" };
          check(snapshot["present"] === "changed" && optional["present"] === "yes");
          const ordered: Record<string, string | undefined> = { ...optional, final: change(optional) };
          check(ordered["present"] === "yes" && ordered["final"] === "last" && optional["present"] === "after");
          const replaced: Record<string, string | undefined> = { present: "before", ...optional };
          check(replaced["present"] === "after");
          let count = 0;
          for (const key in values) { if (values[key] > 9007199254740992n) count++; }
          check(count === 2);
          check(copy(one("generic"))["first"] === "generic");
        }
      ` },
    });
    assert.deepEqual(result.diagnostics, []);
    const run = validateGeneratedProject("indexed-records", result.artifacts, { run: true });
    assert.equal(run.status, 0, JSON.stringify(run));
  });
}

test("Object operations retain native indexed storage and requested dense results", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "indexed_object_api" } },
    files: { "index.ts": `
      import { check } from "@acme/testing";
      function list<Value>(values: Record<string, Value>): Value[] { return Object.values(values); }
      export function main(): void {
        const values: Record<string, string | undefined> = { one: "value" };
        const source: Record<string, string | undefined> = { two: undefined };
        check(Object.keys(values).length === 1);
        check(Object.values(values)[0] === "value");
        check(list(values)[0] === "value");
        check(Object.entries(values)[0]![0] === "one");
        check(Object.hasOwn(values, "one") && !Object.hasOwn(values, "two"));
        const result = Object.assign(values, source);
        check(result === values && Object.hasOwn(result, "two"));
        delete values["one"];
        check(!Object.hasOwn(values, "one") && values["one"] === undefined);
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("indexed-object-api", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});
