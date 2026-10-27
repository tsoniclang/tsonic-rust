import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustStructuralShapeField } from "../../../target-model/records/objects/structural-shapes.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { cloneRustExpression as cloneExpression } from "../../target-ast/syntax/expressions.js";
import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import { checkRustDataWrite } from "./data-writes.js";
import { readRustStructuralObjectField, writeRustStructuralObjectField } from "./project-objects.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function readRustStructuralObjectProperty(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  field: RustStructuralShapeField,
  storageIndex: number,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.property;
  const valueCarrier = selected?.value;
  const storedCarrier = selected?.stored;
  const getterCarrier = selected?.getter;
  if (context.syntheticNames === undefined || field.property === undefined ||
    valueCarrier === undefined || storedCarrier === undefined || getterCarrier === undefined ||
    !rustTargetTypeRefEquals(resultCarrier, field.carrier)) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "property_receiver",
  );
  const getterName = allocateRustSyntheticName(
    context.syntheticNames,
    "property_getter",
  );
  const storedName = allocateRustSyntheticName(
    context.syntheticNames,
    "property_value",
  );
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const getterCall = callRustStructuralObjectAccessor(
    getterName,
    [cloneExpression(receiverPath)],
    context,
  );
  if (getterCall === undefined) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  const presentValue = field.presence === "optional"
    ? { kind: "call" as const, path: "Some", args: [getterCall] }
    : getterCall;
  const storedValue = readRustStructuralObjectField(
    receiverPath,
    field.targetName,
    storedCarrier,
    context,
  );
  const absentGetterValue: RustExpr = field.presence === "optional"
    ? storedValue
    : {
        kind: "match",
        expression: storedValue,
        arms: [{
          pattern: {
            kind: "tuple-variant",
            path: "Some",
            elements: [{ kind: "binding", name: storedName }],
          },
          expression: { kind: "path", path: storedName },
        }, {
          pattern: { kind: "path", path: "None" },
          expression: {
            kind: "unreachable",
            message: "required structural property has neither stored data nor a getter",
          },
        }],
      };
  return rustValueBlock([{ name: receiverName, value: cloneExpression(receiver) }], {
      kind: "match",
      expression: readRustStructuralObjectField(
        receiverPath,
        field.property.getterTargetName,
        getterCarrier,
        context,
      ),
      arms: [{
        pattern: {
          kind: "tuple-variant",
          path: "Some",
          elements: [{ kind: "binding", name: getterName }],
        },
        expression: presentValue,
      }, {
        pattern: { kind: "path", path: "None" },
        expression: absentGetterValue,
      }],
    });
}

export function writeRustStructuralObjectProperty(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  field: RustStructuralShapeField,
  storageIndex: number,
  operator: RustAssignmentOperator,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.property;
  const valueCarrier = selected?.value;
  const setterCarrier = selected?.setter;
  if (context.syntheticNames === undefined || field.property?.setterTargetName === undefined ||
    valueCarrier === undefined || setterCarrier === undefined) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "property_receiver",
  );
  const setterName = allocateRustSyntheticName(
    context.syntheticNames,
    "property_setter",
  );
  const valueName = allocateRustSyntheticName(context.syntheticNames, "property_value");
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
    readonly mutable?: boolean;
  }[] = [{ name: receiverName, value: cloneExpression(receiver) }];
  const selectedValue: RustExpr = { kind: "path", path: valueName };
  let update: RustExpr | undefined;
  if (operator !== "=") {
    const currentValue = readRustStructuralObjectProperty(
      receiverCarrier,
      receiverPath,
      field,
      storageIndex,
      field.carrier,
      context,
    );
    if (currentValue === undefined) {
      failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
    }
    bindings.push({
      name: valueName,
      mutable: true,
      value: currentValue,
    });
    update = {
      kind: "assignment",
      operator,
      target: { kind: "path", path: valueName },
      value,
    };
  } else {
    bindings.push({ name: valueName, value });
  }
  const setterCall = callRustStructuralObjectAccessor(
    setterName,
    [cloneExpression(receiverPath), selectedValue],
    context,
  );
  if (setterCall === undefined) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  let storedWrite = writeRustStructuralObjectField(
    receiverPath,
    field.targetName,
    "=",
    { kind: "call", path: "Some", args: [selectedValue] },
  );
  if (context.input.program.records.storedField.get("structural-object", receiverCarrier, storageIndex)?.check !== undefined) {
    const region = context.fallibleBoundary;
    const checked = region === undefined ? undefined : checkRustDataWrite("receiver", receiverPath, storedWrite, region);
    if (checked === undefined) failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
    storedWrite = checked;
  }
  const write: RustExpr = {
    kind: "match",
    expression: readRustStructuralObjectField(
      receiverPath,
      field.property.setterTargetName,
      setterCarrier,
      context,
    ),
    arms: [{
      pattern: {
        kind: "tuple-variant",
        path: "Some",
        elements: [{ kind: "binding", name: setterName }],
      },
      expression: setterCall,
    }, {
      pattern: { kind: "path", path: "None" },
      expression: storedWrite,
    }],
  };
  return rustValueBlock(bindings, update === undefined
      ? write
      : {
          kind: "evaluate-then",
          effect: update,
          discard: "unit",
          value: write,
        });
}

export function mutateRustStructuralObjectProperty(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  field: RustStructuralShapeField,
  storageIndex: number,
  mutation: (field: RustExpr) => RustExpr | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "property_receiver",
  );
  const valueName = allocateRustSyntheticName(
    context.syntheticNames,
    "property_value",
  );
  const resultName = allocateRustSyntheticName(
    context.syntheticNames,
    "accessor_result",
  );
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const currentValue = readRustStructuralObjectProperty(
    receiverCarrier,
    receiverPath,
    field,
    storageIndex,
    field.carrier,
    context,
  );
  const storedValue = writeRustStructuralObjectProperty(
    receiverCarrier,
    receiverPath,
    field,
    storageIndex,
    "=",
    { kind: "path", path: valueName },
    context,
  );
  if (currentValue === undefined || storedValue === undefined) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  const changed = mutation({ kind: "path", path: valueName });
  if (changed === undefined) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  return rustValueBlock([{ name: receiverName, value: cloneExpression(receiver) }, {
      name: valueName,
      mutable: true,
      value: currentValue,
    }, {
      name: resultName,
      value: changed,
    }], {
      kind: "evaluate-then",
      effect: storedValue,
      discard: "unit",
      value: { kind: "path", path: resultName },
    });
}

function callRustStructuralObjectAccessor(
  bindingName: string,
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  const region = context.fallibleBoundary;
  if (region === undefined) {
    failRustPlannerInvariant("An admitted structural property requires its exact sealed accessors, storage and native error context.", context.sourceFile);
  }
  return rustPropagateLocalError(region, rustTargetRuntimeErrorType, {
    kind: "method-call", receiver: { kind: "path", path: bindingName }, method: "call",
    args: [{ kind: "tuple-literal", elements: arguments_ }],
  });
}
