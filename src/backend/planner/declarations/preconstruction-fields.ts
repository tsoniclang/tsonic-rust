import type { Node } from "@tsonic/tsts";
import {
  KindPropertyAccessExpression,
  asSourceNode,
  Node_Expression,
} from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type {
  RustEffectiveExpressionOverride,
  RustPlanContext,
} from "../program/plan-context.js";

export interface RustPreconstructionFieldValue {
  readonly declaration: Node;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly expression: RustExpr;
}

export function rustNamedFieldPath(
  receiver: RustExpr,
  storagePath: readonly string[],
): RustExpr {
  return storagePath.reduce<RustExpr>(
    (current, name) => ({ kind: "field", receiver: current, name }),
    receiver,
  );
}

export function prepareRustPreconstructionNode(
  root: Node,
  availableFields: readonly RustPreconstructionFieldValue[],
  context: RustPlanContext,
  resolveSelectedDeclaration?: (declaration: Node) => Node | undefined,
): RustPlanContext | undefined {
  const { ast } = context.input.program.source;
  const overrides = new Map(context.expressionOverrides ?? []);
  let failure: { readonly node: Node; readonly message: string } | undefined;

  const visit = (node: Node): void => {
    if (failure !== undefined) {
      return;
    }
    const kind = ast.kindName(node);
    if (kind === KindPropertyAccessExpression) {
      const receiver = Node_Expression(ast, node);
      const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
      if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
        const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
        const selected = context.input.program.facts.getSelectedTargetProperty(node);
        const selectedDeclaration = asSourceNode(
          selected?.provenance?.sourceSelectedDeclaration,
          ast,
        );
        const implementationDeclaration = selectedDeclaration === undefined
          ? undefined
          : resolveSelectedDeclaration?.(selectedDeclaration) ?? selectedDeclaration;
        const matches = implementationDeclaration === undefined
          ? []
          : availableFields.filter((field) =>
              field.declaration === implementationDeclaration);
        const field = matches.length === 1 ? matches[0] : undefined;
        if (
          fact?.kind !== "source-field" ||
          fact.valueSemantics.kind !== "stored" ||
          selected?.operationKind !== "property" ||
          selected.operationId !== fact.operationId ||
          field === undefined ||
          fact.storageIndex !== field.storageIndex ||
          !rustTargetTypeRefEquals(fact.resultCarrier, field.carrier) ||
          !rustTargetTypeRefEquals(selected.resultType, field.carrier)
        ) {
          failure = {
            node,
            message:
              "Preconstruction field reads require one exact, already-initialized field selected by finalized TSTS property evidence.",
          };
          return;
        }
        const override: RustEffectiveExpressionOverride = {
          expression: field.expression,
          carrier: field.carrier,
          valueForm: "storage",
        };
        overrides.set(node, override);
        return;
      }
    }
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      failure = {
        node,
        message:
          "Preconstruction `this` may only read an exact field that has already been initialized.",
      };
      return;
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };

  visit(root);
  if (failure !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, failure.node),
      "rust.backend.class-field-initializer",
      failure.message,
    ));
    return undefined;
  }
  return { ...context, expressionOverrides: overrides };
}
