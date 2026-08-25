import type { Node } from "@tsonic/tsts";
import {
  KindVariableStatement,
  Node_Expression,
  Node_Initializer,
  Node_Type,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import { rustFixedArrayCarrierValue } from "../../../target-model/types/index.js";
import type { RustPattern, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

interface FixedMutableLoanBinding {
  readonly statement: Node;
  readonly rootId: string;
  readonly rootName: string;
  readonly index: number;
  readonly bindingName: string;
}

export function planRustFixedMutableLoanStatements(
  children: readonly (Node | undefined)[],
  context: RustPlanContext,
): ReadonlyMap<Node, readonly RustStmt[]> {
  const result = new Map<Node, readonly RustStmt[]>();
  let pending: FixedMutableLoanBinding[] = [];
  const flush = (): void => {
    if (pending.length >= 2 && fixedBindingsAreDisjoint(pending)) {
      const first = pending[0]!;
      const pattern: RustPattern = {
        kind: "slice",
        prefix: pending.map((binding) => ({
          kind: "binding" as const,
          name: binding.bindingName,
        })),
        suffix: [],
      };
      const indexes = {
        kind: "slice-literal" as const,
        elements: pending.map((binding) => ({
          kind: "int-literal" as const,
          text: String(binding.index),
        })),
      };
      result.set(first.statement, Object.freeze([{
        kind: "let-pattern",
        pattern,
        init: {
          kind: "method-call",
          receiver: {
            kind: "method-call",
            receiver: { kind: "path", path: first.rootName },
            method: "get_disjoint_mut",
            args: [indexes],
          },
          method: "unwrap",
          args: [],
        },
      }]));
      for (const binding of pending.slice(1)) {
        result.set(binding.statement, Object.freeze([]));
      }
    }
    pending = [];
  };
  for (const child of children) {
    const candidate = child === undefined
      ? undefined
      : fixedMutableLoanBinding(child, context);
    if (candidate === undefined ||
      (pending.length > 0 && pending[0]!.rootId !== candidate.rootId)) {
      flush();
    }
    if (candidate !== undefined) pending.push(candidate);
  }
  flush();
  return result;
}

function fixedMutableLoanBinding(
  statement: Node,
  context: RustPlanContext,
): FixedMutableLoanBinding | undefined {
  const { ast } = context.input.program.source;
  if (ast.kindName(statement) !== KindVariableStatement) return undefined;
  const declarations = (VariableDeclarationList_Declarations(
    ast,
    VariableStatement_DeclarationList(ast, statement),
  ) ?? []).filter((declaration): declaration is Node => declaration !== undefined);
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0]!;
  if (Node_Type(ast, declaration) !== undefined) return undefined;
  const initializer = Node_Initializer(ast, declaration);
  const operation = initializer === undefined
    ? undefined
    : context.input.program.ownership.operationFor(initializer);
  if (initializer === undefined || operation?.kind !== "mutable-borrow") return undefined;
  const sourceArguments = ast.arguments(initializer).filter(
    (argument): argument is Node => argument !== undefined,
  );
  const sourceValue = sourceArguments.length === 1 ? sourceArguments[0] : undefined;
  if (sourceValue === undefined || !ast.is.IsElementAccessExpression(sourceValue)) return undefined;
  const rootExpression = Node_Expression(ast, sourceValue);
  if (rootExpression === undefined || !ast.is.IsIdentifier(rootExpression)) return undefined;
  const rootDeclaration = context.input.program.sourceNavigation
    .sourceReferenceFor(rootExpression)?.declaration;
  const rootPlace = rootDeclaration === undefined
    ? undefined
    : context.input.program.ownership.placeFor(rootDeclaration);
  const projection = operation.place.projections[operation.place.projections.length - 1];
  const rootCarrier = rootDeclaration === undefined
    ? undefined
    : context.input.program.facts.getRuntimeCarrierFact(rootDeclaration)?.carrier;
  const fixed = rustFixedArrayCarrierValue(rootCarrier);
  const rootName = rootDeclaration === undefined
    ? undefined
    : context.input.program.names.nameForDeclaration(rootDeclaration);
  const bindingName = context.input.program.names.nameForDeclaration(declaration);
  if (rootDeclaration === undefined || rootPlace === undefined || rootName === undefined ||
    bindingName === undefined || fixed === undefined || projection?.kind !== "fixed-index" ||
    projection.index < 0 || projection.index >= fixed.length ||
    operation.place.rootId !== rootPlace.rootId || rootPlace.projections.length !== 0 ||
    operation.place.projections.length !== 1) {
    return undefined;
  }
  return Object.freeze({
    statement,
    rootId: rootPlace.rootId,
    rootName,
    index: projection.index,
    bindingName,
  });
}

function fixedBindingsAreDisjoint(
  bindings: readonly FixedMutableLoanBinding[],
): boolean {
  return new Set(bindings.map((binding) => binding.index)).size === bindings.length;
}
