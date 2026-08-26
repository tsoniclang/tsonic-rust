import type { Node } from "@tsonic/tsts";
import type { RustPattern, RustStmt } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustFixedMutableLoanStatements(
  children: readonly (Node | undefined)[],
  context: RustPlanContext,
): ReadonlyMap<Node, readonly RustStmt[]> | undefined {
  const result = new Map<Node, readonly RustStmt[]>();
  for (const child of children) {
    if (child === undefined || result.has(child)) continue;
    const group = context.input.program.ownership.fixedMutableLoanGroupFor(child);
    if (group === undefined || group.bindings[0]?.statement !== child) continue;
    const rootName = context.input.program.names.nameForDeclaration(
      group.bindings[0].rootDeclaration,
    );
    const bindingNames = group.bindings.map((binding) =>
      context.input.program.names.nameForDeclaration(binding.declaration));
    if (rootName === undefined || bindingNames.some((name) => name === undefined)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, child),
        "rust.backend.fixed-index-loan-names",
        "A sealed fixed-index mutable-loan group requires exact target binding names.",
      ));
      return undefined;
    }
    const pattern: RustPattern = {
      kind: "slice",
      prefix: bindingNames.map((name) => ({
        kind: "binding" as const,
        name: name!,
      })),
      suffix: [],
    };
    result.set(child, Object.freeze([{
      kind: "let-pattern",
      pattern,
      init: {
        kind: "method-call",
        receiver: {
          kind: "method-call",
          receiver: { kind: "path", path: rootName },
          method: "get_disjoint_mut",
          args: [{
            kind: "slice-literal",
            elements: group.bindings.map((binding) => ({
              kind: "int-literal" as const,
              text: String(binding.index),
            })),
          }],
        },
        method: "unwrap",
        args: [],
      },
    }]));
    for (const binding of group.bindings.slice(1)) {
      result.set(binding.statement, Object.freeze([]));
    }
  }
  return result;
}
