import type {
  RustExpr,
  RustItem,
  RustStmt,
  RustType,
  RustVisibility,
} from "../../target-ast/nodes.js";
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
  type: RustType,
  value: RustExpr,
  visibility: RustVisibility,
  syntheticNames: RustSyntheticNameState,
  attrs: readonly string[] = [],
): readonly RustItem[] {
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
          target: type,
        }]),
    {
      kind: "thread-local" as const,
      name,
      visibility,
      ...(attrs.length === 0 ? {} : { attrs }),
      type: {
        kind: "named" as const,
        path: "rt::ModuleCell",
        typeArguments: [storedType],
      },
      value: {
        kind: "call" as const,
        path: "rt::ModuleCell::initialized",
        args: [value],
      },
      constInitializer: false,
    },
  ];
}

export function planRustModuleCell(
  name: string,
  type: RustType,
  value: RustExpr,
  visibility: RustVisibility,
  syntheticNames: RustSyntheticNameState,
  attrs: readonly string[] = [],
): PlannedRustModuleCell {
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
            target: type,
          }]),
      {
        kind: "thread-local",
        name,
        visibility,
        ...(attrs.length === 0 ? {} : { attrs }),
        type: {
          kind: "named",
          path: "rt::ModuleCell",
          typeArguments: [storedType],
        },
        value: { kind: "call", path: "rt::ModuleCell::new", args: [] },
        constInitializer: true,
      },
    ],
    initialization: {
      kind: "expr",
      expr: {
        kind: "block",
        bindings: [{ name: valueName, value }],
        value: rustModuleCellAccess(
          { kind: "path", path: name },
          "initialize",
          [{ kind: "path", path: valueName }],
          cellName,
        ),
      },
    },
  };
}

export function rustModuleCellAccess(
  cell: RustExpr,
  method: "initialize" | "load" | "location",
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
