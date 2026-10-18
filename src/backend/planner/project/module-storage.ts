import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { type RustAttribute } from "../../target-ast/syntax/attributes.js";
import type {
  RustExpr,
  RustItem,
  RustStmt,
  RustType,
  RustVisibility,
} from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustNativeBindingStorage } from "../../../target-model/records/physical-emission-contexts.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import {
  allocateRustSyntheticName,
  allocateRustSyntheticTypeName,
  type RustSyntheticNameState,
} from "../names/synthetic.js";

export interface PlannedRustModuleCell {
  readonly items: readonly RustItem[];
  readonly initialization: RustStmt;
}

export function planRustHoistedModuleCell(
  name: string,
  storage: RustNativeBindingStorage,
  value: RustExpr,
  visibility: RustVisibility,
  syntheticNames: RustSyntheticNameState,
  context: RustPlanContext,
  attrs: readonly RustAttribute[] = [],
): readonly RustItem[] {
  if (storage.kind !== "module-cell" || storage.valueConstructor === null)
    return failRustPlannerInvariant("A hoisted native module cell requires its completed initialized storage constructor.");
  const type = rustTypeFromSelectedNativeCarrierInContext(storage.payloadCarrier, context);
  const slot = rustTypeFromSelectedNativeCarrierInContext(storage.slotCarrier, context);
  const callableAlias = type.kind === "named" && type.path === "rt::Callable"
    ? allocateRustSyntheticTypeName(syntheticNames, `${name}_callable`)
    : undefined;
  const storedType: RustType = callableAlias === undefined
    ? type
    : { kind: "named", path: callableAlias };
  return [
    ...(callableAlias === undefined
      ? []
      : [{
          kind: "type-alias" as const,
          name: callableAlias,
          visibility: "private" as const,
          generics: emptyRustGenerics,
          target: type,
        }]),
    {
      kind: "thread-local" as const,
      name,
      visibility,
      ...(attrs.length === 0 ? {} : { attrs }),
      type: moduleSlotType(slot, storedType, callableAlias !== undefined),
      value: {
        kind: "call" as const,
        path: storage.valueConstructor,
        args: [value],
      },
      constInitializer: false,
    },
  ];
}

export function planRustModuleCell(
  name: string,
  storage: RustNativeBindingStorage,
  value: RustExpr | undefined,
  visibility: RustVisibility,
  syntheticNames: RustSyntheticNameState,
  context: RustPlanContext,
  attrs: readonly RustAttribute[] = [],
): PlannedRustModuleCell {
  if (storage.kind !== "module-cell" || storage.deferredConstructor === null)
    return failRustPlannerInvariant("A native module cell requires its completed TLS declaration storage constructor.");
  const type = rustTypeFromSelectedNativeCarrierInContext(storage.payloadCarrier, context);
  const slot = rustTypeFromSelectedNativeCarrierInContext(storage.slotCarrier, context);
  const cellName = allocateRustSyntheticName(syntheticNames, "module_binding");
  const valueName = allocateRustSyntheticName(syntheticNames, "module_value");
  const callableAlias = type.kind === "named" && type.path === "rt::Callable"
    ? allocateRustSyntheticTypeName(syntheticNames, `${name}_callable`)
    : undefined;
  const storedType: RustType = callableAlias === undefined
    ? type
    : { kind: "named", path: callableAlias };
  return {
    items: [
      ...(callableAlias === undefined
        ? []
        : [{
            kind: "type-alias" as const,
            name: callableAlias,
            visibility: "private" as const,
            generics: emptyRustGenerics,
            target: type,
          }]),
      {
        kind: "thread-local",
        name,
        visibility,
        ...(attrs.length === 0 ? {} : { attrs }),
        type: moduleSlotType(slot, storedType, callableAlias !== undefined),
        value: { kind: "call", path: storage.deferredConstructor, args: [] },
        constInitializer: true,
      },
    ],
    initialization: {
      kind: "expr",
      expr: value === undefined ? rustModuleCellAccess(
        { kind: "path", path: name }, "declare", [], cellName,
      ) : rustValueBlock([{ name: valueName, value }], rustModuleCellAccess(
          { kind: "path", path: name },
          "initialize",
          [{ kind: "path", path: valueName }],
          cellName,
        )),
    },
  };
}

function moduleSlotType(slot: RustType, payload: RustType, aliased: boolean): RustType {
  if (!aliased) return slot;
  if (slot.kind !== "named" || slot.genericArguments?.length !== 1 || slot.genericArguments[0]?.kind !== "type")
    return failRustPlannerInvariant("A native module payload alias requires its exact completed one-payload slot syntax.");
  return { ...slot, genericArguments: [{ kind: "type", type: payload }] };
}

export function rustModuleCellAccess(
  cell: RustExpr,
  method: "initialize" | "declare" | "load" | "store" | "location",
  args: readonly RustExpr[],
  cellName = "module_binding",
): RustExpr {
  return {
    kind: "method-call",
    receiver: cell,
    method: "with",
    args: [{
      kind: "closure",
      params: [{ name: cellName, byRefCopy: false }],
      body: {
        kind: "method-call",
        receiver: { kind: "path", path: cellName },
        method,
        args,
      },
    }],
  };
}
