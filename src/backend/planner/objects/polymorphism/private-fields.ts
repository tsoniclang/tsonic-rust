import { rustHiddenAttribute } from "../../../target-ast/syntax/attributes.js";
import type { RustExpr, RustImplFunction, RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustProjectImplementationVisibility } from "../project-storage-abi.js";
import type { ProjectClassStateLayer } from "./model.js";
import { rustProjectRepresentationGenerics } from "./names.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import { readRustCapturedField, rustCapturedFieldStorage, rustCapturedFieldLocation } from "../captured-fields.js";

export function planProjectPrivateStateAccessors(
  stateType: RustType,
  layer: ProjectClassStateLayer,
  publiclyReachable: boolean,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const representation = context.input.program.records.objectRepresentation.get(
    layer.definition,
  );
  if (representation === undefined) {
    failRustPlannerInvariant("An admitted native state accessor requires its exact project representation.", layer.definition.declaration);
  }
  const fields = layer.fields.filter(field => {
    if (field.origin === "external") return false;
    const visibility = context.input.program.records.nativeMemberVisibility.get(field.declaration, false);
    if (visibility === undefined) failRustPlannerInvariant("An admitted native state field requires its sealed visibility.", field.declaration);
    return visibility === "private";
  });
  if (fields.length === 0) {
    return [];
  }
  const visibility = rustProjectImplementationVisibility(publiclyReachable);
  const functions: RustImplFunction[] = [];
  for (const field of fields) {
    const readName = context.input.program.records.projectMemberSlot.get(field.declaration, "read");
    const writeName = field.readonly
      ? undefined
      : context.input.program.records.projectMemberSlot.get(field.declaration, "write");
    if (readName === undefined || (!field.readonly && writeName === undefined)) {
      failRustPlannerInvariant("Private project field has no exact generated storage-access identity.", field.declaration);
    }
    const fieldExpression: RustExpr = {
      kind: "field",
      receiver: { kind: "path", path: "self" },
      name: field.targetName,
    };
    const ownership = context.input.program.records.carrierRead.get(field.carrier);
    if (ownership === undefined) failRustPlannerInvariant("An admitted native state accessor requires its sealed field read ownership.", field.declaration);
    functions.push({ kind: "function",
      name: readName,
      visibility,
      ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"),
      params: [],
      returnType: field.type,
      body: {
        statements: [{
          kind: "tail",
          expr: rustCapturedFieldStorage(field.declaration, context) !== undefined
            ? readRustCapturedField(rustCapturedFieldStorage(field.declaration, context)!,
              { kind: "method-call", receiver: fieldExpression, method: "clone", args: [] }, field.carrier, context)
            : ownership.copy
            ? fieldExpression
            : { kind: "method-call", receiver: fieldExpression, method: "clone", args: [] },
        }],
      },
    });
    if (writeName !== undefined) {
      functions.push({ kind: "function",
        name: writeName,
        visibility,
        ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter("mut-ref"),
        params: [{ name: "value", type: field.type }],
        body: {
          statements: [{
            kind: "expr",
            expr: rustCapturedFieldStorage(field.declaration, context) === undefined ? {
              kind: "assignment",
              operator: "=",
              target: fieldExpression,
              value: { kind: "path", path: "value" },
            } : rustCapturedFieldLocation(rustCapturedFieldStorage(field.declaration, context)!,
              { kind: "method-call", receiver: fieldExpression, method: "clone", args: [] }, field.carrier, context)
              .write({ kind: "path", path: "value" }, context)!,
          }],
        },
      });
    }
  }
  return [{
    kind: "impl",
    generics: rustProjectRepresentationGenerics(representation, context),
    target: stateType,
    members: functions,
  }];
}
