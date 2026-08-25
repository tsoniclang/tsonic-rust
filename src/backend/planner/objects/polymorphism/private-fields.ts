import { rustCopyTrait } from "../../../../target-model/types/index.js";
import { rustProjectMemberIsPrivate } from "../../../../analysis/project-types/member-privacy.js";
import { emptyRustAstGenerics, type RustExpr, type RustImplFunction, type RustItem, type RustType } from "../../../target-ast/nodes.js";
import { rustDocHiddenAttribute } from "../../../target-ast/attributes.js";
import { rustReferenceReceiver } from "../../../target-ast/builders.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { diagnosticInput } from "../../program/plan-context.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustSealedCarrierSupportsTrait } from "../../ownership/traits.js";
import { rustProjectImplementationVisibility } from "../project-storage-abi.js";
import type { ProjectClassStateLayer } from "./model.js";
import { rustProjectGenerics } from "./names.js";

export function planProjectPrivateStateAccessors(
  stateType: RustType,
  layer: ProjectClassStateLayer,
  publiclyReachable: boolean,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const fields = layer.fields.filter((field) =>
    rustProjectMemberIsPrivate(context.input.program.source.ast, field.declaration));
  if (fields.length === 0) {
    return [];
  }
  const visibility = rustProjectImplementationVisibility(publiclyReachable);
  const functions: RustImplFunction[] = [];
  for (const field of fields) {
    const readName = context.input.program.projectTypes.memberSlotName(field.declaration, "read");
    const writeName = field.readonly
      ? undefined
      : context.input.program.projectTypes.memberSlotName(field.declaration, "write");
    if (readName === undefined || (!field.readonly && writeName === undefined)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, field.declaration),
        "rust.backend.private-field-storage-abi",
        "Private project field has no exact generated storage-access identity.",
      ));
      return undefined;
    }
    const fieldExpression: RustExpr = {
      kind: "field",
      receiver: { kind: "path", path: "self" },
      name: field.targetName,
    };
    functions.push({
      name: readName,
      visibility,
      ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
      generics: emptyRustAstGenerics,
      receiver: rustReferenceReceiver(false),
      params: [],
      returnType: field.type,
      body: {
        statements: [{
          kind: "tail",
          expr: rustSealedCarrierSupportsTrait(field.carrier, rustCopyTrait, context)
            ? fieldExpression
            : { kind: "method-call", receiver: fieldExpression, method: "clone", args: [] },
        }],
      },
    });
    if (writeName !== undefined) {
      functions.push({
        name: writeName,
        visibility,
        ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
        generics: emptyRustAstGenerics,
        receiver: rustReferenceReceiver(true),
        params: [{ name: "value", type: field.type }],
        body: {
          statements: [{
            kind: "expr",
            expr: {
              kind: "assignment",
              operator: "=",
              target: fieldExpression,
              value: { kind: "path", path: "value" },
            },
          }],
        },
      });
    }
  }
  const generics = rustProjectGenerics(layer.definition, context);
  if (generics === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, layer.definition.declaration),
      "rust.backend.private-field-generics",
      "Private project-state accessors have no exact renderable Rust generic contract.",
    ));
    return undefined;
  }
  return [{
    kind: "impl",
    generics,
    target: stateType,
    polarity: "positive",
    safety: "safe",
    functions,
    associatedTypes: [],
    associatedConstants: [],
  }];
}
