import { failRustPlannerInvariant } from "../../invariants.js";
import type { Node } from "@tsonic/tsts";
import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import { createRustSourceFile, type RustItem } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustAuthoredStructScope(
  declaration: Node,
  item: Extract<RustItem, { readonly kind: "struct" }>,
  context: RustPlanContext,
): RustItem {
  const selected = context.input.program.records.classDeclaration.get(declaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted class requires its selected authored type scope.", declaration);
  const scope = selected.scope;
  if (scope === undefined) return item;
  return {
    kind: "mod-decl",
    name: scope,
    visibility: item.visibility,
    attrs: [rustHiddenAttribute],
    body: createRustSourceFile([
      {
        ...item,
        fields: item.fields.map(field => field.visibility === "private"
          ? { ...field, visibility: "parent" }
          : field),
      },
    ]),
  };
}
