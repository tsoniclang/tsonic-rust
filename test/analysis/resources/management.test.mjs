import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { rustOperationContext } from "../../../dist/analysis/program/walk.js";
import { selectRustResourceManagement } from "../../../dist/analysis/resources/management.js";

test("resource alternatives retain complete native source-method dispatch correspondence", () => {
  const { context, walk } = analyzeRustOperations(`
    export class Resource { constructor() {} [Symbol.dispose](): void {} }
    export function use(): void { using resource = new Resource(); }
  `, { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsVariableDeclaration(node) &&
    context.ast.variableDeclarationKind(node) === "using");
  assert.equal(declaration !== undefined, true);
  const native = rustOperationContext(walk, declaration);
  const checked = context.semanticsFor(declaration).operations.resourceManagement(declaration);
  assert.equal(checked?.disposal.kind, "selected");
  const disposer = checked.disposal.alternatives[0].selectedDeclaration;
  const carrier = context.records.resourceManagement.get(declaration).resourceCarrier;
  const first = { virtualSlot: "dispose", ownerCarrier: carrier };
  const otherOwner = { kind: "source-primitive", name: "int32" };
  for (const [name, targets, accepted] of [
    ["nonvirtual", [undefined, undefined], true],
    ["equal native dispatch", [first, { ...first, ownerCarrier: { ...carrier } }], true],
    ["missing second dispatch", [first, undefined], false],
    ["missing first dispatch", [undefined, first], false],
    ["different virtual slot", [first, { ...first, virtualSlot: "other" }], false],
    ["different native owner", [first, { ...first, ownerCarrier: otherOwner }], false],
  ]) {
    let selected = -1;
    const semantics = context.semanticsFor(declaration);
    const input = { ...native, semanticsFor: node => node === declaration ? { ...semantics,
      operations: { ...semantics.operations, resourceManagement: () => ({ ...checked,
        disposal: { ...checked.disposal, alternatives: [checked.disposal.alternatives[0], checked.disposal.alternatives[0]] } }) },
    } : native.semanticsFor(node) };
    const options = { ...walk.operationOptions, projectTypes: { ...walk.operationOptions.projectTypes,
      isPolymorphic: () => targets[selected] !== undefined,
      relationship: () => ({ kind: "related", targetType: targets[selected].ownerCarrier }),
    }, projectMethodDispatch: { ...walk.operationOptions.projectMethodDispatch,
      variantForMember: () => ({ virtualSlot: targets[selected].virtualSlot }),
    } };
    const result = selectRustResourceManagement(declaration, input, options, method => {
      assert.equal(method === disposer, true, name);
      selected++;
      return { selfMode: context.records.selfMode.get(method), async: false, fallible: false };
    });
    assert.equal(selected, 1, `${name}: both exact selected alternatives are considered`);
    assert.equal(result.kind === "selected", accepted, name);
    if (!accepted) assert.equal(result.reason,
      "Rust resource alternatives must resolve to one identical carrier and disposal operation.", name);
    else assert.equal(result.projectDisposerDeclarations.length, 1, name);
  }
});
