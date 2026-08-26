import type { Node } from "@tsonic/tsts";
import {
  KindVariableStatement,
  Node_Expression,
  Node_Initializer,
  Node_Type,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import { rustFixedArrayCarrierValue } from "../../target-model/types/index.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type {
  RustFixedMutableLoanBinding,
  RustFixedMutableLoanGroup,
} from "./model.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import { requireDenseRustOwnershipNodes } from "./source-shape.js";

export function analyzeRustFixedMutableLoanGroups(
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
): WeakMap<Node, RustFixedMutableLoanGroup> {
  const candidateByStatement = new WeakMap<Node, RustFixedMutableLoanBinding>();
  const parents = new Set<Node>();
  for (const statement of inventory.nodes) {
    const candidate = fixedMutableLoanBinding(statement, operations, inventory, input);
    if (candidate === undefined) continue;
    candidateByStatement.set(statement, candidate);
    const parent = input.ast.parent(statement);
    if (parent !== undefined) parents.add(parent);
  }
  const groupsByStatement = new WeakMap<Node, RustFixedMutableLoanGroup>();
  for (const parent of parents) {
    const siblings = requireDenseRustOwnershipNodes(
      input.ast.statements(parent),
      "Statement list contains an undefined slot during fixed-index loan analysis.",
      parent,
    );
    let pending: RustFixedMutableLoanBinding[] = [];
    const flush = (): void => {
      if (pending.length >= 2 && fixedBindingsAreDisjoint(pending)) {
        const group = Object.freeze<RustFixedMutableLoanGroup>({
          bindings: Object.freeze(pending),
        });
        for (const binding of pending) groupsByStatement.set(binding.statement, group);
      }
      pending = [];
    };
    for (const statement of siblings) {
      const candidate = candidateByStatement.get(statement);
      if (candidate === undefined || pending.length > 0 &&
        pending[0]!.rootDeclaration !== candidate.rootDeclaration) {
        flush();
      }
      if (candidate !== undefined) pending.push(candidate);
    }
    flush();
  }
  return groupsByStatement;
}

function fixedMutableLoanBinding(
  statement: Node,
  operations: RustOwnershipOperationInventory,
  inventory: RustOwnershipNodeInventory,
  input: RustOwnershipAnalysisInput,
): RustFixedMutableLoanBinding | undefined {
  const { ast } = input;
  if (ast.kindName(statement) !== KindVariableStatement) return undefined;
  const declarationList = VariableStatement_DeclarationList(ast, statement);
  if (declarationList === undefined) return undefined;
  const declarations = requireDenseRustOwnershipNodes(
    VariableDeclarationList_Declarations(ast, declarationList),
    "Variable declaration list contains an undefined slot during fixed-index loan analysis.",
    declarationList,
  );
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0]!;
  if (Node_Type(ast, declaration) !== undefined) return undefined;
  const initializer = Node_Initializer(ast, declaration);
  const operation = initializer === undefined ? undefined : operations.byNode.get(initializer);
  if (initializer === undefined || operation?.kind !== "mutable-borrow") return undefined;
  const sourceArguments = requireDenseRustOwnershipNodes(
    ast.arguments(initializer),
    "Mutable-borrow call contains an undefined argument slot during fixed-index loan analysis.",
    initializer,
  );
  const sourceValue = sourceArguments.length === 1 ? sourceArguments[0] : undefined;
  if (sourceValue === undefined || !ast.is.IsElementAccessExpression(sourceValue)) return undefined;
  const rootExpression = Node_Expression(ast, sourceValue);
  if (rootExpression === undefined || !ast.is.IsIdentifier(rootExpression)) return undefined;
  const rootDeclaration = input.navigation.sourceReferenceFor(rootExpression)?.declaration;
  const rootPlace = rootDeclaration === undefined
    ? undefined
    : inventory.places.get(rootDeclaration);
  const projection = operation.place.projections[operation.place.projections.length - 1];
  const rootCarrier = rootDeclaration === undefined
    ? undefined
    : input.facts.getRuntimeCarrierFact(rootDeclaration)?.carrier;
  const fixed = rustFixedArrayCarrierValue(rootCarrier);
  if (rootDeclaration === undefined || rootPlace === undefined || fixed === undefined ||
    projection?.kind !== "fixed-index" || projection.index < 0 ||
    projection.index >= fixed.length || operation.place.rootId !== rootPlace.rootId ||
    rootPlace.projections.length !== 0 || operation.place.projections.length !== 1) {
    return undefined;
  }
  return Object.freeze({
    statement,
    declaration,
    rootDeclaration,
    index: projection.index,
  });
}

function fixedBindingsAreDisjoint(
  bindings: readonly RustFixedMutableLoanBinding[],
): boolean {
  return new Set(bindings.map((binding) => binding.index)).size === bindings.length;
}
