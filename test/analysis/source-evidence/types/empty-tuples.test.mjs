import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../../helpers/rust-session.mjs";
import { resolveRustAuthoredTargetType } from "../../../../dist/analysis/source-evidence/types/resolution/tuples.js";
import { resolveRustTargetTypeRef } from "../../../../dist/analysis/source-evidence/types/resolution/source.js";
import { denseDefined } from "../../../../dist/analysis/source-evidence/types/resolution/project.js";
import { rustTupleTargetType } from "../../../../dist/policy/types/collections/tuple-carrier.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

test("known authored, readonly, aliased, inferred and transformed empty tuples use native unit", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
type Empty = [];
type NoArguments = Parameters<() => void>;
export function authored(value: []): [] { return value; }
export function readonlyTuple(value: readonly []): readonly [] { return value; }
export function aliased(value: Empty): Empty { return value; }
export function transformed(value: NoArguments): NoArguments { return value; }
export function inferred() { const value: [] = []; return value; }
export function heterogeneous(value: [number, string]): [number, string] { return value; }
export function homogeneous(value: [number, number]): [number, number] { return value; }
export function generic<Value>(value: Value): Value { return value; }
` } });
  const ast = program.source.ast;
  const declarations = new Map();
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) declarations.set(ast.text(ast.name(node)), node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const nativeUnit = rustTupleTargetType([]);
  for (const name of ["authored", "readonlyTuple", "aliased", "transformed", "inferred"]) {
    const declaration = declarations.get(name);
    assert.equal(declaration !== undefined, true, `${name}: actual checked declaration exists`);
    const returned = program.records.sourceCallableReturn.get(declaration)?.returnCarrier;
    assert.equal(rustTargetTypeRefEquals(returned, nativeUnit), true,
      `${name}: a known zero-element tuple retains the existing allocation-free native unit`);
    assert.equal(program.records.typeEmission.get(returned) !== undefined, true,
      `${name}: the unit carrier is admitted before rendering`);
    const parameter = ast.parameters(declaration)[0];
    if (parameter !== undefined) {
      const input = program.records.sourceParameterAbi.get(parameter);
      assert.equal(rustTargetTypeRefEquals(input?.valueCarrier, nativeUnit), true,
        `${name}: the exact checked empty tuple is not an unknown or allocated collection parameter`);
    }
  }
  const number = rustSourcePrimitiveTargetType("float64");
  for (const [name, expected] of [
    ["heterogeneous", rustTupleTargetType([number, rustStringTargetType()])],
    ["homogeneous", rustTupleTargetType([number, number])],
  ]) {
    const returned = program.records.sourceCallableReturn.get(declarations.get(name))?.returnCarrier;
    assert.equal(rustTargetTypeRefEquals(returned, expected), true,
      `${name}: the existing tuple versus homogeneous fixed-array policy is unchanged`);
  }
  const generic = program.records.sourceCallableReturn.get(declarations.get("generic"))?.returnCarrier;
  assert.equal(generic !== undefined, true, "an actual unresolved native generic retains its own carrier");
  assert.equal(rustTargetTypeRefEquals(generic, nativeUnit), false,
    "a type parameter is not converted into an empty tuple");
  const authored = declarations.get("authored");
  assert.equal(resolveRustAuthoredTargetType(authored, undefined, undefined, new Set([authored])), undefined,
    "a cyclic source subject refuses before touching any reader");
});

test("empty tuple admission does not turn missing, sparse or unresolved evidence into unit", () => {
  assert.equal(denseDefined([])?.length, 0, "a known dense empty tuple is valid evidence");
  assert.equal(denseDefined([undefined]), undefined, "a missing tuple element is not an empty tuple");
  assert.equal(denseDefined(new Array(1)), undefined, "a sparse tuple is not an empty tuple");
  assert.equal(resolveRustTargetTypeRef(undefined, undefined, undefined), undefined,
    "missing source evidence is not a native unit type");
  for (const source of [
    "export function invalid(value: [Missing]): [Missing] { return value; }",
    "type Cycle = Cycle; export function invalid(value: Cycle): Cycle { return value; }",
    "export function invalid(): [] { return [1]; }",
    "export function invalid(value: []): number { return value[0]; }",
  ]) {
    assert.throws(() => compileRust({ files: { "index.ts": source } }), /error TS/u,
      "invalid or incompatible checked tuple evidence is still rejected");
  }
});
