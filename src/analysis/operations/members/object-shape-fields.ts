import type { RustOperationAnalysisContext } from "../../program/operation-context.js";

import { KindPropertyAssignment, KindShorthandPropertyAssignment, orderEnumerableOwnStringProperties } from "@tsonic/target-api/source";

import type { Node } from "@tsonic/tsts";

import type { RustSourceObjectField, RustSourceObjectShape } from "../../../target-model/records/types/source-types.js";

type SelectedAuthoredObjectFields =
  | { readonly kind: "resolved"; readonly fields: readonly RustSourceObjectField[] }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectedAuthoredObjectFields(
  shape: RustSourceObjectShape,
  context: RustOperationAnalysisContext,
): SelectedAuthoredObjectFields {
  const selected: {
    readonly field: RustSourceObjectField;
    readonly owner: Node;
    readonly start: number;
  }[] = [];
  for (const field of shape.fields) {
    const declarations = field.declarations.filter((declaration) => {
      const kind = context.ast.kindName(declaration);
      const owner = context.ast.parent(declaration);
      return owner !== undefined &&
        context.ast.kindName(owner) === "KindObjectLiteralExpression" &&
        (kind === KindPropertyAssignment || kind === KindShorthandPropertyAssignment ||
          kind === "KindGetAccessor" || kind === "KindSetAccessor" ||
          kind === "KindMethodDeclaration");
    });
    const getters = declarations.filter((declaration) =>
      context.ast.kindName(declaration) === "KindGetAccessor");
    const setters = declarations.filter((declaration) =>
      context.ast.kindName(declaration) === "KindSetAccessor");
    const methods = declarations.filter((declaration) =>
      context.ast.kindName(declaration) === "KindMethodDeclaration");
    const expectedCount = field.accessor === undefined
      ? 1
      : field.accessor.setter
        ? 2
        : 1;
    if (declarations.length !== expectedCount ||
      (field.accessor === undefined && field.method !== true &&
        (getters.length !== 0 || setters.length !== 0 || methods.length !== 0)) ||
      (field.accessor !== undefined && (
        getters.length !== 1 || setters.length !== (field.accessor.setter ? 1 : 0) ||
        methods.length !== 0
      )) ||
      (field.method === true && (
        methods.length !== 1 || getters.length !== 0 || setters.length !== 0
      ))) {
      return {
        kind: "rejected",
        reason: `Closed Object projection member '${field.sourceName}' is not owned by one exact object-literal property contract.`,
      };
    }
    const owner = context.ast.parent(declarations[0]!);
    const ranges = declarations.map((declaration) =>
      context.ast.authoredRange(declaration));
    if (owner === undefined || context.ast.kindName(owner) !== "KindObjectLiteralExpression" ||
      declarations.some((declaration) => context.ast.parent(declaration) !== owner) ||
      ranges.some((range) => range.kind !== "authored") ||
      declarations.some((declaration) => context.ast.questionToken(declaration) !== undefined)) {
      return {
        kind: "rejected",
        reason: `Closed Object projection member '${field.sourceName}' has no exact required own-property declaration.`,
      };
    }
    selected.push({
      field,
      owner,
      start: Math.min(...ranges.map((range) =>
        range.kind === "authored" ? range.start : Number.MAX_SAFE_INTEGER)),
    });
  }
  const owner = selected[0]?.owner;
  if (owner === undefined || selected.some((entry) => entry.owner !== owner) ||
    new Set(selected.map((entry) => entry.start)).size !== selected.length ||
    context.ast.properties(owner).length !== shape.fields.reduce(
      (count, field) => count + (field.accessor?.setter === true ? 2 : 1),
      0,
    )) {
    return {
      kind: "rejected",
      reason: "Closed Object projection fields do not belong to one unambiguous authored object literal.",
    };
  }
  const authored = [...selected]
    .sort((left, right) => left.start - right.start)
    .map((entry) => entry.field);
  return {
    kind: "resolved",
    fields: orderEnumerableOwnStringProperties(
      authored,
      (field) => field.sourceName,
    ),
  };
}
