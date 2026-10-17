import assert from "node:assert/strict";
import test from "node:test";
import { rustNamedTargetType } from "../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const constant = value => ({ kind: "const", value: { kind: "integer", value } });

test("instantiated native identity depends on exact arguments, not optional spelling defaults", () => {
  const argument = constant("9007199254740993");
  const explicit = rustNamedTargetType("crate.Token", "crate::Token", [argument], [], undefined, [], undefined, []);
  const defaulted = rustNamedTargetType("crate.Token", "crate::Token", [argument], [argument], undefined, [], undefined, []);
  assert(rustTargetTypeRefEquals(explicit, defaulted));
  assert(rustTargetTypeRefEquals(defaulted, explicit));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "crate::Token", [constant("9007199254740992")], [], undefined, [], undefined, [])));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("other.Token", "crate::Token", [argument], [], undefined, [], undefined, [])));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "other::Token", [argument], [], undefined, [], undefined, [])));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "crate::Token", [argument], [], {
    implementations: [{ trait: { kind: "trait-ref", id: "core::marker::Copy", path: "core::marker::Copy", genericArguments: [], associatedConstraints: [] }, requirements: [] }],
  }, [], undefined, [])));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "crate::Token", [argument], [argument, argument], undefined, [], undefined, [])));
  const outer = inner => rustNamedTargetType("crate.Outer", "crate::Outer", [{ kind: "type", type: inner }], [], undefined, [], undefined, []);
  assert(rustTargetTypeRefEquals(outer(explicit), outer(defaulted)));
});
