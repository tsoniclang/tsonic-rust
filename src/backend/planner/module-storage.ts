import type {
  RustExpr,
  RustItem,
  RustStmt,
  RustType,
  RustVisibility,
} from "../rust-ast/nodes.js";
import {
  allocateRustSyntheticName,
  allocateRustSyntheticTypeName,
  type RustSyntheticNameState,
} from "./synthetic-names.js";

export interface PlannedRustModuleCell {
  readonly items: readonly RustItem[];
  readonly initialization: RustStmt;
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
