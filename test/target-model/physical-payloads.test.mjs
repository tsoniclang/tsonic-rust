import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustPhysicalPayloadFor } from "../../dist/target-model/types/physical-payloads.js";
import { rustSourceUnionTargetType } from "../../dist/target-model/types/carriers/source-types.js";
import { rustFutureTargetType } from "../../dist/target-model/types/carriers/primitives.js";
import { rustSourceOptionalTargetType } from "../../dist/target-model/types/projections.js";
import { instantiateRustSourceUnionPayloads } from "../../dist/target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const integer = { kind: "source-primitive", name: "int32" };
const parameter = { kind: "type-parameter", name: "Value", identity: "decl:Value" };
const future = rustFutureTargetType(parameter);
const physical = { kind: "type-parameter", name: "Pending", identity: "storage:Pending" };
const region = { kind: "parameter", name: "Region", identity: "decl:Region" };
const argument = type => ({ kind: "type", type });
const alias = (name = "Outcome", value = parameter) => rustSourceUnionTargetType("/src/value.ts", name, [argument(value)]);

function fixture() {
  const definitions = createRustTypeDefinitionRegistry();
  for (const name of ["Outcome", "Foreign"]) {
    assert.equal(definitions.registerSourceUnion({ carrier: alias(name), variants: [
      { name: "Integer", carrier: integer }, { name: "Pending", carrier: future },
    ] }, true), true);
  }
  const logical = alias();
  const selected = instantiateRustSourceUnionPayloads(logical, [integer, physical], definitions);
  assert.equal(selected !== undefined, true);
  return { definitions: definitions.seal(), logical, selected };
}

test("physical payload selection reuses authored union variants through exact option and reference wrappers", () => {
  const { definitions, logical, selected } = fixture();
  assert.equal(rustTargetTypeRefEquals(rustPhysicalPayloadFor(logical, selected, future, definitions), physical), true);
  const wrap = referent => ({ kind: "reference", referent: rustSourceOptionalTargetType(referent),
    mutable: false, lifetime: region });
  const resolved = rustPhysicalPayloadFor(wrap(logical), wrap(selected), future, definitions);
  assert.equal(resolved?.identity, physical.identity);
  assert.equal(rustPhysicalPayloadFor(future, physical, future, definitions) === physical, true);
});

test("physical payload selection rejects foreign source identity and malformed native payload arity", () => {
  const { definitions, logical, selected } = fixture();
  const other = instantiateRustSourceUnionPayloads(alias("Foreign"), [integer, physical], definitions);
  const wrongGeneric = instantiateRustSourceUnionPayloads(alias("Outcome", integer), [integer, physical], definitions);
  const short = rustSourceUnionTargetType("/src/value.ts", "Outcome", [argument(parameter)], "authored",
    { kind: "physical", types: [physical] });
  for (const [name, carrier] of [["foreign owner", other], ["different source arguments", wrongGeneric],
    ["native arity", short], ["not a union", physical], ["malformed carrier", {}]]) {
    assert.equal(rustPhysicalPayloadFor(logical, carrier, future, definitions) === undefined, true, name);
  }
  assert.equal(rustPhysicalPayloadFor(logical, selected, { kind: "source-primitive", name: "bool" }, definitions) === undefined,
    true, "an absent logical variant cannot be guessed by a physical name");
});

test("physical payload selection preserves reference lifetime and mutability and rejects missing optional topology", () => {
  const { definitions } = fixture();
  const logical = { kind: "reference", referent: future, mutable: false, lifetime: region };
  const valid = { ...logical, referent: physical };
  assert.equal(rustPhysicalPayloadFor(logical, valid, future, definitions) === physical, true);
  for (const [name, carrier] of [["mutability", { ...valid, mutable: true }],
    ["lifetime", { ...valid, lifetime: { kind: "static" } }], ["reference", physical]]) {
    assert.equal(rustPhysicalPayloadFor(logical, carrier, future, definitions) === undefined, true, name);
  }
  assert.equal(rustPhysicalPayloadFor(rustSourceOptionalTargetType(future), physical, future, definitions) === undefined,
    true, "absence topology cannot be silently removed");
});
