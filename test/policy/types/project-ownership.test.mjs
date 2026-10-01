import assert from "node:assert/strict";
import test from "node:test";
import { resolveProjectSourceCarrier } from "../../../dist/policy/types/resolution/project.js";

test("project type classification rejects foreign declarations before project semantic queries", () => {
  for (const kind of ["provider-type-literal", "source-profile-mapped-type", "native-interface", "native-class", "source-profile-alias"]) {
    const declaration = Object.freeze({ kind });
    const selected = [];
    let queries = 0;
    const reject = () => { queries++; throw new Error("Foreign declarations have no project semantic owner."); };
    const context = {
      currentSemantics: { declarations: { symbolDeclarations: () => [declaration] } },
      source: { navigation: { isProjectDeclaration(node) { selected.push(node); return false; } } },
      ast: { is: { IsInterfaceDeclaration: reject } },
      semanticsFor: reject,
    };
    const options = { sourceTypes: { carrierForDeclaration: reject } };
    assert.equal(resolveProjectSourceCarrier({}, { values: [] }, context, options), undefined);
    assert.deepEqual(selected, [declaration]);
    assert.equal(queries, 0);
  }
});
