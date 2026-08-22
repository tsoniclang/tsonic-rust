import { isRustCopyCarrier } from "../../../../target-model/types/index.js";
import { rustProjectMemberIsPrivate } from "../../../../analysis/project-types/member-privacy.js";
import type { RustExpr, RustImplFunction, RustItem, RustType } from "../../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { diagnosticInput } from "../../program/plan-context.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustProjectImplementationVisibility } from "../project-storage-abi.js";
import type { ProjectClassStateLayer } from "./model.js";
import { rustProjectTypeParameters } from "./names.js";

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
      ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
      selfParam: "ref",
      params: [],
      returnType: field.type,
      body: {
        statements: [{
          kind: "tail",
          expr: isRustCopyCarrier(field.carrier)
            ? fieldExpression
            : { kind: "method-call", receiver: fieldExpression, method: "clone", args: [] },
        }],
      },
    });
    if (writeName !== undefined) {
      functions.push({
        name: writeName,
        visibility,
        ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
        selfParam: "mut-ref",
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
  return [{
    kind: "impl",
    ...(rustProjectTypeParameters(layer.definition).length === 0
      ? {}
      : { typeParams: rustProjectTypeParameters(layer.definition) }),
    target: stateType,
    functions,
  }];
}
