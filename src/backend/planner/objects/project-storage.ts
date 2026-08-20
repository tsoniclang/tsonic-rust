import type { TargetTypeRef } from "../../../policy/types/model.js";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type { RustAssignmentOperator } from "../../model/syntax.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import type { RustExpr } from "../../rust-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustActiveErrorType } from "../program/plan-context.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import type { RustStructuralShapeField } from "../../../analysis/objects/structural-shape-plan.js";
import {
  createRustStructuralObject,
  mutateRustProjectObjectField,
  mutateRustStructuralObjectField,
  readRustProjectObjectField,
  readRustStructuralObjectField,
  writeRustProjectObjectField,
  writeRustStructuralObjectField,
} from "./project-objects.js";
import {
  allocateRustSyntheticName,
} from "../names/synthetic.js";
import {
  rustCallableProtocol,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustStructuralPropertyGetterStorageCarrier,
  rustStructuralPropertySetterStorageCarrier,
  rustStructuralPropertyValueCarrier,
  rustStructuralMethodCallableCarrier,
  rustStructuralMethodStorageCarrier,
} from "../../../policy/types/target-types.js";

export type RustStructuralObjectFieldInitializer =
  | { readonly kind: "stored"; readonly value: RustExpr }
  | { readonly kind: "method"; readonly value: RustExpr }
  | {
      readonly kind: "accessor";
      readonly getter: RustExpr;
      readonly setter?: RustExpr;
    };

export function createRustStructuralObjectFromCarrier(
  carrier: TargetTypeRef,
  initializers: readonly RustStructuralObjectFieldInitializer[],
  context: RustPlanContext,
): RustExpr | undefined {
  const definition = context.input.structuralShapes.definitionForCarrier(carrier);
  if (definition === undefined || definition.fields.length !== initializers.length) {
    return undefined;
  }
  const fields = definition.fields.flatMap((field, index) => {
    const initializer = initializers[index];
    if (initializer === undefined ||
      (field.method === true) !== (initializer.kind === "method") ||
      (field.storage === "stored" && initializer.kind === "accessor") ||
      (field.storage === "property" && initializer.kind === "method")) {
      return [undefined];
    }
    if (field.storage === "stored") {
      if (initializer.kind === "accessor") {
        return [undefined];
      }
      return [{ name: field.targetName, value: initializer.value }];
    }
    if (field.property === undefined || initializer.kind === "method") {
      return [undefined];
    }
    const stored = initializer.kind === "accessor"
      ? { kind: "none" as const }
      : field.presence === "optional"
        ? initializer.value
        : { kind: "call" as const, path: "Some", args: [initializer.value] };
    const getter = initializer.kind === "accessor"
      ? { kind: "call" as const, path: "Some", args: [initializer.getter] }
      : { kind: "none" as const };
    const setter = initializer.kind === "accessor" && initializer.setter !== undefined
      ? { kind: "call" as const, path: "Some", args: [initializer.setter] }
      : { kind: "none" as const };
    return [{
      name: field.targetName,
      value: stored,
    }, {
      name: field.property.getterTargetName,
      value: getter,
    }, ...(field.property.setterTargetName === undefined
      ? []
      : [{
          name: field.property.setterTargetName,
          value: setter,
        }])];
  });
  if (fields.some((field) => field === undefined)) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  return createRustStructuralObject(
    `crate::${context.structuralShapesModuleName}::${definition.targetName}`,
    fields as readonly { readonly name: string; readonly value: RustExpr }[],
  );
}

export function rustDirectProjectFieldStoragePath(
  receiverCarrier: TargetTypeRef,
  storageIndex: number,
  context: RustPlanContext,
): readonly string[] | undefined {
  const definition = context.input.projectTypes.definitionForCarrier(receiverCarrier);
  if (definition === undefined || context.input.projectTypes.isPolymorphic(definition)) {
    return undefined;
  }
  const external = context.input.projectTypes.externalBaseForDefinition(definition)?.fields ?? [];
  const layout = rustProjectObjectLayout(definition.declaration, context.input.ast);
  const declaration = storageIndex < external.length
    ? external.find((field) => field.storageIndex === storageIndex)?.declaration
    : layout?.fields.find((field) =>
        external.length + field.storageIndex === storageIndex)?.declaration;
  const name = declaration === undefined
    ? undefined
    : context.input.projectTypes.fieldStorageName(definition, declaration);
  return name === undefined ? undefined : [name];
}

export function readRustStoredObjectField(
  storage: "project-object" | "object-handle",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  if (storage === "object-handle") {
    const field = context.input.structuralShapes.field(receiverCarrier, storageIndex);
    if (field === undefined) {
      return undefined;
    }
    if (field.method === true) {
      return undefined;
    }
    return field.storage === "property"
      ? readRustStructuralObjectProperty(
          receiverCarrier,
          receiver,
          field,
          resultCarrier,
          context,
        )
      : readRustStructuralObjectField(receiver, field.targetName, resultCarrier);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  const representation = rustProjectObjectRepresentation(receiverCarrier, context);
  return path === undefined || representation === undefined
    ? undefined
    : readRustProjectObjectField(receiver, path, resultCarrier, representation);
}

export function readRustStructuralObjectMethodStorage(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  context: RustPlanContext,
): RustExpr | undefined {
  const field = context.input.structuralShapes.field(receiverCarrier, storageIndex);
  const storageCarrier = field?.method === true
    ? rustStructuralMethodStorageCarrier(receiverCarrier, field.carrier, field.presence)
    : undefined;
  if (field === undefined || storageCarrier === undefined) {
    return undefined;
  }
  return readRustStructuralObjectField(
    receiver,
    field.targetName,
    storageCarrier,
  );
}

export interface RustStructuralMethodStorageOverride {
  readonly expression: RustExpr;
  readonly carrier: TargetTypeRef;
}

export function invokeRustStructuralObjectMethod(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  arguments_: readonly RustExpr[],
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
  storageOverride?: RustStructuralMethodStorageOverride,
): RustExpr | undefined {
  const field = context.input.structuralShapes.field(receiverCarrier, storageIndex);
  const callableCarrier = field?.method === true
    ? rustStructuralMethodCallableCarrier(field.carrier, field.presence)
    : undefined;
  const callable = rustCallableProtocol(callableCarrier);
  const storageCarrier = field?.method === true
    ? rustStructuralMethodStorageCarrier(receiverCarrier, field.carrier, field.presence)
    : undefined;
  const rawStorageCarrier = field?.presence === "optional"
    ? rustOptionElementCarrier(storageCarrier)
    : storageCarrier;
  if (field === undefined || callable === undefined ||
    rawStorageCarrier === undefined ||
    callable.parameters.length !== arguments_.length ||
    !rustTargetTypeRefEquals(callable.result, resultCarrier) ||
    (field.presence === "required") !== (storageOverride === undefined) ||
    (storageOverride !== undefined &&
      !rustTargetTypeRefEquals(storageOverride.carrier, rawStorageCarrier)) ||
    context.syntheticNames === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_receiver",
  );
  const methodName = allocateRustSyntheticName(
    context.syntheticNames,
    "structural_method",
  );
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const method = storageOverride?.expression ?? readRustStructuralObjectField(
    receiverPath,
    field.targetName,
    rawStorageCarrier,
  );
  return {
    kind: "block",
    bindings: [{ name: receiverName, value: receiver }, {
      name: methodName,
      value: method,
    }],
    value: {
      kind: "method-call",
      receiver: { kind: "path", path: methodName },
      method: "call",
      args: [{
        kind: "tuple-literal",
        elements: [{
          kind: "method-call",
          receiver: receiverPath,
          method: "clone",
          args: [],
        }, ...arguments_],
      }],
    },
  };
}

export function writeRustStoredObjectField(
  storage: "project-object" | "object-handle",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  operator: RustAssignmentOperator,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  if (storage === "object-handle") {
    const field = context.input.structuralShapes.field(receiverCarrier, storageIndex);
    if (field === undefined) {
      return undefined;
    }
    if (field.method === true || field.readonly) {
      return undefined;
    }
    return field.storage === "property"
      ? writeRustStructuralObjectProperty(
          receiverCarrier,
          receiver,
          field,
          operator,
          value,
          context,
        )
      : writeRustStructuralObjectField(receiver, field.targetName, operator, value);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  const representation = rustProjectObjectRepresentation(receiverCarrier, context);
  return path === undefined || representation === undefined
    ? undefined
    : writeRustProjectObjectField(receiver, path, operator, value, representation);
}

export function mutateRustStoredObjectField(
  storage: "project-object" | "object-handle",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  mutation: (field: RustExpr) => RustExpr | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (storage === "object-handle") {
    const field = context.input.structuralShapes.field(receiverCarrier, storageIndex);
    if (field === undefined) {
      return undefined;
    }
    if (field.method === true || field.readonly) {
      return undefined;
    }
    return field.storage === "property"
      ? mutateRustStructuralObjectProperty(
          receiverCarrier,
          receiver,
          field,
          mutation,
          context,
        )
      : mutateRustStructuralObjectField(receiver, field.targetName, mutation);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  const representation = rustProjectObjectRepresentation(receiverCarrier, context);
  return path === undefined || representation === undefined
    ? undefined
    : mutateRustProjectObjectField(receiver, path, mutation, representation);
}

export function rustProjectObjectRepresentation(
  carrier: TargetTypeRef,
  context: RustPlanContext,
) {
  return context.input.objectRepresentations.representationFor(
    context.input.projectTypes.definitionForCarrier(carrier),
  );
}

function readRustStructuralObjectProperty(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  field: RustStructuralShapeField,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const valueCarrier = rustStructuralPropertyValueCarrier(field.carrier, field.presence);
  const storedCarrier = valueCarrier === undefined ? undefined : rustOptionTargetType(valueCarrier);
  const getterCarrier = rustStructuralPropertyGetterStorageCarrier(
    receiverCarrier,
    field.carrier,
    field.presence,
  );
  if (context.syntheticNames === undefined || field.property === undefined ||
    valueCarrier === undefined || storedCarrier === undefined || getterCarrier === undefined ||
    !rustTargetTypeRefEquals(resultCarrier, field.carrier)) {
    return undefined;
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
    return undefined;
  }
  const presentValue = field.presence === "optional"
    ? { kind: "call" as const, path: "Some", args: [getterCall] }
    : getterCall;
  const storedValue = readRustStructuralObjectField(
    receiverPath,
    field.targetName,
    storedCarrier,
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
  return {
    kind: "block",
    bindings: [{ name: receiverName, value: cloneExpression(receiver) }],
    value: {
      kind: "match",
      expression: readRustStructuralObjectField(
        receiverPath,
        field.property.getterTargetName,
        getterCarrier,
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
    },
  };
}

function writeRustStructuralObjectProperty(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  field: RustStructuralShapeField,
  operator: RustAssignmentOperator,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const valueCarrier = rustStructuralPropertyValueCarrier(field.carrier, field.presence);
  const setterCarrier = rustStructuralPropertySetterStorageCarrier(
    receiverCarrier,
    field.carrier,
    field.presence,
  );
  if (context.syntheticNames === undefined || field.property?.setterTargetName === undefined ||
    valueCarrier === undefined || setterCarrier === undefined) {
    return undefined;
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
      field.carrier,
      context,
    );
    if (currentValue === undefined) {
      return undefined;
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
    return undefined;
  }
  const storedWrite = writeRustStructuralObjectField(
    receiverPath,
    field.targetName,
    "=",
    { kind: "call", path: "Some", args: [selectedValue] },
  );
  const write: RustExpr = {
    kind: "match",
    expression: readRustStructuralObjectField(
      receiverPath,
      field.property.setterTargetName,
      setterCarrier,
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
  return {
    kind: "block",
    bindings,
    value: update === undefined
      ? write
      : {
          kind: "evaluate-then",
          effect: update,
          discard: "unit",
          value: write,
        },
  };
}

function mutateRustStructuralObjectProperty(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  field: RustStructuralShapeField,
  mutation: (field: RustExpr) => RustExpr | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
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
    field.carrier,
    context,
  );
  const storedValue = writeRustStructuralObjectProperty(
    receiverCarrier,
    receiverPath,
    field,
    "=",
    { kind: "path", path: valueName },
    context,
  );
  if (currentValue === undefined || storedValue === undefined) {
    return undefined;
  }
  const changed = mutation({ kind: "path", path: valueName });
  if (changed === undefined) {
    return undefined;
  }
  return {
    kind: "block",
    bindings: [{ name: receiverName, value: cloneExpression(receiver) }, {
      name: valueName,
      mutable: true,
      value: currentValue,
    }, {
      name: resultName,
      value: changed,
    }],
    value: {
      kind: "evaluate-then",
      effect: storedValue,
      discard: "unit",
      value: { kind: "path", path: resultName },
    },
  };
}

function callRustStructuralObjectAccessor(
  bindingName: string,
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  const resultErrorType = rustActiveErrorType(context);
  if (resultErrorType === undefined) {
    return undefined;
  }
  return {
    kind: "try",
    resultErrorType,
    operandErrorType: rustTargetRuntimeErrorType,
    expr: {
      kind: "method-call",
      receiver: { kind: "path", path: bindingName },
      method: "call",
      args: [{ kind: "tuple-literal", elements: arguments_ }],
    },
  };
}

function cloneExpression(expression: RustExpr): RustExpr {
  return {
    kind: "method-call",
    receiver: expression,
    method: "clone",
    args: [],
  };
}
