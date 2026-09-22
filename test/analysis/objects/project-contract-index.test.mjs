import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("project contract indexes retain exact generic edges and exclude unrelated classes", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
interface Slot<T> { value: T; }
abstract class Base<T> implements Slot<T> {
  value: T;
  constructor(value: T) { this.value = value; }
}
class Numeric extends Base<number> { constructor() { super(7); } }
class OtherNumeric extends Base<number> { constructor() { super(9); } }
class Textual extends Base<string> { constructor() { super("text"); } }
class Unrelated { value: number = 7; }
interface IntSlot extends Slot<number> {}
interface OtherIntSlot extends Slot<number> {}
interface Named { tag: string; }
class BothFirst implements IntSlot, Named { value: number = 1; tag: string = "first"; }
class BothSecond implements OtherIntSlot, Named { value: number = 2; tag: string = "second"; }
export function read(value: Slot<number>): number { return value.value; }
` } });
  const policy = program.projectTypes;
  const definition = name => {
    const selected = policy.definitions.find(candidate => candidate.sourceName === name);
    assert.ok(selected, name);
    return selected;
  };
  const slot = definition("Slot");
  const base = definition("Base");
  const numeric = definition("Numeric");
  const textual = definition("Textual");
  const implementations = policy.concreteClassesFor(slot);
  assert.deepEqual(implementations.map(candidate => candidate.sourceName), ["Numeric", "OtherNumeric", "Textual", "BothFirst", "BothSecond"]);
  assert.equal(policy.concreteClassesFor(slot), implementations);
  assert.ok(Object.isFrozen(implementations));
  assert.deepEqual(policy.contractsForClass(numeric).map(candidate => candidate.sourceName), ["Base", "Slot", "Numeric"]);
  assert.equal(policy.relationship(policy.openCarrier(definition("Unrelated")), slot).kind, "unrelated");
  const numericRelation = policy.relationship(policy.openCarrier(numeric), slot);
  const textualRelation = policy.relationship(policy.openCarrier(textual), slot);
  assert.equal(numericRelation.kind, "related");
  assert.equal(textualRelation.kind, "related");
  assert.equal(rustTargetTypeRefEquals(numericRelation.targetType, textualRelation.targetType), false);
  assert.deepEqual(policy.concreteClassesFor(base).map(candidate => candidate.sourceName), ["Numeric", "OtherNumeric", "Textual"]);
  assert.deepEqual(policy.downcastRoutesFor(slot).map(route => route.target.sourceName),
    ["Base", "Base", "BothFirst", "BothSecond", "IntSlot", "Named", "Numeric", "OtherIntSlot", "OtherNumeric", "Slot", "Slot", "Textual"]);
  const open = name => policy.openCarrier(definition(name));
  const common = policy.commonSupertype([open("Numeric"), open("OtherNumeric")]);
  assert.ok(common);
  assert.equal(policy.definitionForCarrier(common), base);
  assert.equal(policy.commonSupertype([open("Numeric"), open("Textual")]), undefined);
  assert.equal(policy.commonSupertype([open("Numeric"), open("Unrelated")]), undefined);
  assert.equal(policy.commonSupertype([open("BothFirst"), open("BothSecond")]), undefined);
  assert.equal(policy.commonSupertype([open("Numeric")]), undefined);
  const commonInterface = policy.commonSupertype([open("IntSlot"), open("OtherIntSlot")]);
  assert.ok(commonInterface);
  assert.equal(policy.definitionForCarrier(commonInterface), slot);
  assert.equal(rustTargetTypeRefEquals(commonInterface, numericRelation.targetType), true);
  assert.equal(rustTargetTypeRefEquals(policy.commonSupertype([open("OtherIntSlot"), open("IntSlot")]), commonInterface), true);
});
