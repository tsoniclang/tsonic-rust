import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { RustItem } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "./project-objects.js";
import { rustProjectRepresentationGenerics } from "./polymorphism/names.js";
import { checkedProjectProjectionResultType, planCheckedProjectProjectionCall } from "./checked-project-projections.js";

export function planRustProjectProjectionImplementations(
  definition: RustProjectTypeDefinition, context: RustPlanContext,
): readonly RustItem[] {
  const items: RustItem[] = [];
  const selected = context.input.program.records.projectProjectionImplementations.get(definition);
  if (selected === undefined) failRustPlannerInvariant("An admitted project type requires its sealed native projection inventory.", definition.declaration);
  for (const { route, sourceCarrier, genericOwner } of selected) {
    const sourceType = rustTypeFromCarrierInContext(sourceCarrier, context);
    const targetType = rustTypeFromCarrierInContext(route.targetCarrier, context);
    const representation = genericOwner === undefined ? undefined
      : context.input.program.records.objectRepresentation.get(genericOwner);
    const resultType = checkedProjectProjectionResultType(route.targetCarrier, context);
    if (sourceType === undefined || targetType === undefined || resultType === undefined ||
      genericOwner !== undefined && representation === undefined) {
      failRustPlannerInvariant("A sealed native projection route has no complete source and destination type.", definition.declaration);
    }
    const receiver = { kind: "field" as const, receiver: { kind: "path" as const, path: "source" },
      name: rustProjectObjectDispatchField };
    const projection = route.kind === "checked"
      ? planCheckedProjectProjectionCall(receiver, route.slot, resultType)
      : { kind: "method-call" as const, receiver, method: route.slot, args: [] };
    items.push({ kind: "impl", target: targetType,
      generics: representation === undefined ? emptyRustGenerics : rustProjectRepresentationGenerics(representation, context),
      trait: { kind: "named", path: "core::convert::TryFrom", genericArguments: [{ kind: "type", type: sourceType }] },
      members: [{ kind: "type", name: "Error", generics: emptyRustGenerics, type: { kind: "unit" } }, { kind: "function",
        name: "try_from", visibility: "private", generics: emptyRustGenerics,
        params: [{ name: "source", type: sourceType }],
        returnType: { kind: "named", path: "Result", genericArguments: [
          { kind: "type", type: { kind: "named", path: "Self" } }, { kind: "type", type: { kind: "unit" } },
        ] },
        body: { statements: [{ kind: "let", name: "selected_dispatch", mutable: false, init: projection },
          { kind: "tail", expr: { kind: "match",
          expression: { kind: "path", path: "selected_dispatch" },
          arms: [{ pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "dispatch" }] },
            expression: { kind: "call", path: "Ok", args: [{ kind: "struct-literal", path: "Self", fields: [
              { name: rustProjectObjectIdentityField, value: { kind: "field", receiver: { kind: "path", path: "source" }, name: rustProjectObjectIdentityField } },
              { name: rustProjectObjectDispatchField, value: { kind: "path", path: "dispatch" } },
            ] }] } }, { pattern: { kind: "path", path: "None" },
            expression: { kind: "call", path: "Err", args: [{ kind: "tuple-literal", elements: [] }] } }],
        } }] },
      }],
    });
  }
  return Object.freeze(items);
}
