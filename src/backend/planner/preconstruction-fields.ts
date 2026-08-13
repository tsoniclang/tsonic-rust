import type { Node } from "@tsonic/tsts";
import {
  KindPropertyAccessExpression,
  asSourceNode,
  Node_Expression,
} from "../../common/source-ast.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
} from "../../source/rust-target-types.js";
import type { RustExpr } from "../rust-ast/nodes.js";
import { unsupportedConstructDiagnostic } from "./diagnostics.js";
import { diagnosticInput } from "./plan-context.js";
import type {
  RustEffectiveExpressionOverride,
  RustPlanContext,
} from "./plan-context.js";

export interface RustPreconstructionFieldValue {
  readonly declaration: Node;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly expression: RustExpr;
}

export function rustTupleFieldPath(
  receiver: RustExpr,
  storagePath: readonly number[],
): RustExpr {
  return storagePath.reduce<RustExpr>(
    (current, index) => ({ kind: "field", receiver: current, name: String(index) }),
    receiver,
  );
}

export function prepareRustPreconstructionExpression(
  expression: Node,
  availableFields: readonly RustPreconstructionFieldValue[],
  context: RustPlanContext,
  resolveSelectedDeclaration?: (declaration: Node) => Node | undefined,
): RustPlanContext | undefined {
  const { ast } = context.input;
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
        const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
        const selected = context.input.facts.getSelectedTargetProperty(node);
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
        const planned = isRustCopyCarrier(field.carrier)
          ? field.expression
          : rustCarrierSupportsClone(field.carrier)
            ? {
                kind: "method-call" as const,
                receiver: field.expression,
                method: "clone",
                args: [],
              }
            : undefined;
        if (planned === undefined) {
          failure = {
            node,
            message:
              "Preconstruction field reads require a Copy or Clone Rust carrier so the eventual object field remains initialized.",
          };
          return;
        }
        const override: RustEffectiveExpressionOverride = {
          expression: planned,
          carrier: field.carrier,
          valueForm: "value",
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

  visit(expression);
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
