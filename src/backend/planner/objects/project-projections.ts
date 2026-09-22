import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { RustItem } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "./project-objects.js";
import { rustProjectRepresentationGenerics } from "./polymorphism/names.js";
import { checkedProjectProjectionResultType, planCheckedProjectProjectionCall } from "./checked-project-projections.js";

export function planRustProjectProjectionImplementations(
  definition: RustProjectTypeDefinition, context: RustPlanContext,
): readonly RustItem[] {
  const items: RustItem[] = [];
  for (const { route, sourceCarrier, genericOwner } of context.input.program.declarationGenericRequirements.projectionImplementationsFor(definition)) {
    const sourceType = rustTypeFromCarrierInContext(sourceCarrier, context);
    const targetType = rustTypeFromCarrierInContext(route.targetCarrier, context);
    const representation = genericOwner === undefined ? undefined
      : context.input.program.objectRepresentations.representationFor(genericOwner);
    const resultType = checkedProjectProjectionResultType(route.targetCarrier, context);
    if (sourceType === undefined || targetType === undefined || resultType === undefined ||
      genericOwner !== undefined && representation === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, definition.declaration),
        "rust.backend.project-projection", "A sealed native projection route has no complete source and destination type."));
      continue;
    }
    const receiver = { kind: "field" as const, receiver: { kind: "path" as const, path: "source" },
      name: rustProjectObjectDispatchField };
    const projection = route.kind === "checked"
      ? planCheckedProjectProjectionCall(receiver, route.slot, resultType)
      : { kind: "method-call" as const, receiver, method: route.slot, args: [] };
    items.push({ kind: "impl", target: targetType,
      generics: representation === undefined ? emptyRustGenerics : rustProjectRepresentationGenerics(representation, context),
      trait: { kind: "named", path: "core::convert::TryFrom", genericArguments: [{ kind: "type", type: sourceType }] },
      associatedTypes: [{ name: "Error", type: { kind: "unit" } }], functions: [{
        name: "try_from", visibility: "private", generics: emptyRustGenerics,
        params: [{ name: "source", type: sourceType }],
        returnType: { kind: "named", path: "Result", genericArguments: [
          { kind: "type", type: { kind: "named", path: "Self" } }, { kind: "type", type: { kind: "unit" } },
        ] },
        body: { statements: [{ kind: "tail", expr: { kind: "match",
          expression: projection,
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
