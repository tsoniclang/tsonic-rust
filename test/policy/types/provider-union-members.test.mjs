import assert from "node:assert/strict";
import test from "node:test";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { rustSourceUnionMemberDeclarationIsOwned } from "../../../dist/policy/evidence/source-union-members.js";

test("native union member ownership requires an exact classified provider identity", () => {
  const declaration = {};
  const identity = { providerId: "acme.native", providerModuleId: "acme", moduleSpecifier: "@acme/native", exportId: "Value", memberId: "Value.read" };
  const selected = fact => ({ source: { navigation: { isProjectDeclaration: () => false } },
    facts: { get: (node, key) => node === declaration && key === providerVirtualDeclarationFactKey ? fact : undefined } });
  const options = { jsEnabled: false };
  assert.equal(rustSourceUnionMemberDeclarationIsOwned(declaration, selected(identity), options), true);
  assert.equal(rustSourceUnionMemberDeclarationIsOwned(declaration, selected(undefined), options), false);
  assert.equal(rustSourceUnionMemberDeclarationIsOwned(declaration, selected({ ...identity, memberId: undefined, memberName: "read" }), options), false);
  assert.equal(rustSourceUnionMemberDeclarationIsOwned(declaration, selected({ ...identity, exportId: undefined }), options), false);
});
