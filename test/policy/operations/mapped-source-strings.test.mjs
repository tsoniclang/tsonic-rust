import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/js-surface.js";
import { rustClosureTargetType, rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";

test("mapped string rows retain callback arity and explicit target result constraints", () => {
  const string = rustStringTargetType();
  const number = rustSourcePrimitiveTargetType("float64");
  const byte = rustSourcePrimitiveTargetType("uint8");
  for (const arity of [0, 1, 2]) {
    const callback = rustClosureTargetType([string, number].slice(0, arity), byte);
    const request = {
      ownerName: "ArrayConstructor", memberName: "from", operationKind: "call",
      argumentCarriers: [string, callback], selectedMethodTypeArgumentCarriers: [string, number],
    };
    const selected = selectJsSurfaceOperation(request);
    assert.match(selected?.fact.operationId ?? "", /\.string-map-/u);
    assert.equal(selected.callback.shape, "map");
    assert.equal(selected.callback.sourceArgumentIndex, 1);
    assert.equal(selectJsSurfaceOperation({ ...request, authoredMethodTypeArgumentCarriers: [string, string] }), undefined);
  }
  assert.equal(selectJsSurfaceOperation({
    ownerName: "ArrayConstructor", memberName: "from", operationKind: "call",
    argumentCarriers: [string, rustClosureTargetType([byte], string)],
    selectedMethodTypeArgumentCarriers: [string, string],
  }), undefined);
  const conversion = selectRustSourceValueConversion(number, byte);
  assert.deepEqual(conversion, { kind: "semantic-conversion", id: "checked-f64-to-u8-trunc" });
  assert.equal(rustValueConversionContract(conversion).fallible, true);
});

test("mapped native strings and vectors execute with exact bytes and ordered failure", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "mapped_source_strings" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { uint8 } from "@tsonic/core/types.js";
function byte(value: number): uint8 { return value as uint8; }
export function main(): void {
  const bytes = Array.from("Aÿ", (part: string): uint8 => part.charCodeAt(0) as uint8);
  check(bytes.length === 2 && bytes[0] === 65 && bytes[1] === 255);
  const scalar = Array.from("a😀z", (part: string): string => part);
  check(scalar.length === 3 && scalar.join("") === "a😀z");
  const indexed = Array.from("a😀z", (part: string, index: number): number => index);
  check(indexed.length === 3 && indexed[0] === 0 && indexed[2] === 2);
  let count = 0;
  const zero = Array.from("abc", (): number => { count += 1; return count; });
  check(count === 3 && zero[0] === 1 && zero[2] === 3);
  const empty = Array.from("", (): number => { count += 1; return count; });
  check(count === 3 && empty.length === 0);
  let visited = "";
  let failed = false;
  try {
    Array.from("a😀z", (part: string, index: number): string => {
      visited += part;
      if (index === 1) throw new Error("stop");
      return part;
    });
  } catch { failed = true; }
  check(failed && visited === "a😀");
  const source = new Map<string, string>();
  source.set("first", "A");
  const copied = Array.from(source.values(), (part: string): uint8 => part.charCodeAt(0) as uint8);
  check(copied[0] === 65);
  check(byte(255.9) === 255 && byte(-0.9) === 0);
  let rejected = false;
  try { byte(256); } catch { rejected = true; }
  check(rejected);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /JsArray<u8>/u);
  assert.match(output, /js_abi::array_from_string_try_map/u);
  assert.match(output, /js_abi::array_from_vec_try_map/u);
  assert.doesNotMatch(output, /JsString|\.collect::<Vec<String>>/u);
  const run = validateGeneratedProject("mapped-source-strings", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});
