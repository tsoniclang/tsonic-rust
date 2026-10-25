import assert from "node:assert/strict";
import test from "node:test";
import { rustProviderInputBorrowMode } from "../../../dist/policy/operations/members/input-borrows.js";
import { sourceInput } from "../../../dist/policy/operations/members/abi/conversions.js";
import { rustBorrowedStrTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType,
  rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustBorrowedStrToStringValueConversion, rustJsValueCloneConversion,
  rustStringToBorrowedStrValueConversion, rustStringToJsValueConversion } from "../../../dist/target-model/conversions/model.js";

const source = { kind: "argument", sourceIndex: 0 };

test("provider read roles consume the actual first native conversion's finalized shared contract", () => {
  for (const [label, carrier, mode, conversion, declared, expectedKind] of [
    ["String to borrowed str", rustStringTargetType(), "value", rustStringToBorrowedStrValueConversion, undefined, "semantic"],
    ["borrowed clone result passed by reference", rustJsValueTargetType(), "ref", rustJsValueCloneConversion, undefined, "semantic"],
    ["first conversion borrows before an owned result", rustStringTargetType(), "value",
      rustBorrowedStrToStringValueConversion, rustBorrowedStrTargetType(), "sequence"],
  ]) {
    const input = sourceInput(source, carrier, mode, conversion, undefined, declared);
    assert.equal(input !== undefined, true, label + ": actual native ABI producer admits the input");
    assert.equal(input.conversion.kind, expectedKind, label + ": the intended native transition is selected");
    assert.equal(input.sharedConversion, true, label + ": the ABI producer owns the source borrow decision");
    assert.equal(rustProviderInputBorrowMode(input), "ref", label + ": source ownership consumes that one decision");
    assert.equal(input.sourceCarrier === carrier, true, label + ": original source identity is retained");
  }
});

test("owned conversions do not inherit the converted value's later reference mode", () => {
  const input = sourceInput(source, rustStringTargetType(), "ref", rustStringToJsValueConversion);
  assert.equal(input !== undefined, true, "the actual native conversion is admitted");
  assert.equal(input.conversion.kind, "semantic");
  assert.equal(input.mode, "ref", "the converted JsValue is borrowed by the callee");
  assert.equal(input.sharedConversion, false, "constructing the converted value consumes the owned String");
  assert.equal(rustProviderInputBorrowMode(input), undefined, "borrowing the result never reborrows the original source");
});

test("identity native inputs retain exact shared, exclusive, by-value and reference-value roles", () => {
  for (const [label, carrier, mode, expected] of [
    ["owned String", rustStringTargetType(), "value", undefined],
    ["shared String", rustStringTargetType(), "ref", "ref"],
    ["exclusive String", rustStringTargetType(), "mut-ref", "mut-ref"],
    ["native reference value", rustBorrowedStrTargetType(), "value", "ref"],
    ["native scalar value", rustSourcePrimitiveTargetType("int32"), "value", undefined],
  ]) {
    const input = sourceInput(source, carrier, mode, undefined);
    assert.equal(input !== undefined, true, label + ": actual native input is admitted");
    assert.equal(input.conversion.kind, "identity", label);
    assert.equal(input.sharedConversion, false, label + ": identity is not a conversion borrow");
    assert.equal(rustProviderInputBorrowMode(input), expected, label + ": exact native ownership role");
  }
});

test("an existing exact shared native reference supplies the selected borrowed receiver without owning its referent", () => {
  const receiver = { kind: "target-named", id: "fixture.NativeReceiver" };
  const reference = { kind: "reference", mutable: false, referent: receiver };
  const input = sourceInput({ kind: "receiver" }, reference, "ref", undefined, undefined, receiver);
  assert.equal(input !== undefined, true, "the exact native reference is already the selected parameter");
  assert.equal(input.sourceCarrier === reference, true, "the real native storage identity is unchanged");
  assert.equal(input.conversion.kind, "identity", "no owner clone or dereference conversion is selected");
  assert.equal(input.mode, "value", "the native reference itself is passed, not borrowed again");
  assert.equal(input.parameterCarrier === reference, true, "the parameter remains the original native reference");
  assert.equal(rustProviderInputBorrowMode(input), "ref", "ownership consumes the existing native-reference role");
  for (const [label, carrier, mode, declared] of [
    ["shared cannot become exclusive", reference, "mut-ref", receiver],
    ["shared cannot become owned", reference, "value", receiver],
    ["different native referent", reference, "ref", { kind: "target-named", id: "fixture.OtherReceiver" }],
  ]) assert.equal(sourceInput({ kind: "receiver" }, carrier, mode, undefined, undefined, declared) === undefined, true, label);
  const owned = sourceInput({ kind: "receiver" }, receiver, "ref", undefined, undefined, receiver);
  assert.equal(owned?.mode, "ref", "an actual owned receiver is still borrowed exactly once");
});
