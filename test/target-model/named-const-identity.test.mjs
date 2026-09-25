import assert from "node:assert/strict";
import test from "node:test";
import { rustNamedTargetType } from "../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const constant = value => ({ kind: "const", value: { kind: "integer", value } });

test("instantiated native identity depends on exact arguments, not optional spelling defaults", () => {
  const argument = constant("9007199254740993");
  const explicit = rustNamedTargetType("crate.Token", "crate::Token", [argument]);
  const defaulted = rustNamedTargetType("crate.Token", "crate::Token", [argument], [argument]);
  assert(rustTargetTypeRefEquals(explicit, defaulted));
  assert(rustTargetTypeRefEquals(defaulted, explicit));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "crate::Token", [constant("9007199254740992")])));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("other.Token", "crate::Token", [argument])));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "other::Token", [argument])));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "crate::Token", [argument], [], {
    implementations: [{ traitPath: "core::marker::Copy", requirements: [] }],
  })));
  assert(!rustTargetTypeRefEquals(explicit, rustNamedTargetType("crate.Token", "crate::Token", [argument], [argument, argument])));
  const outer = inner => rustNamedTargetType("crate.Outer", "crate::Outer", [{ kind: "type", type: inner }]);
  assert(rustTargetTypeRefEquals(outer(explicit), outer(defaulted)));
});
