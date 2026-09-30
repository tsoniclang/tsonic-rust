import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { isRustVecCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustBindingStorageFactKey, rustMutatedReferentFactKey } from "../facts/keys.js";
import { rustNativeArrayStorageKey } from "../../target-model/operations/native-memory.js";

export interface RustLocalStorageAliasPlan {
  owner(declaration: Node): Node | undefined;
  requiresMutableOwner(declaration: Node): boolean;
}

export function analyzeRustLocalStorageAliases(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
}): RustLocalStorageAliasPlan {
  const { ast, navigation, facts } = input;
  const owners = new WeakMap<Node, Node>();
  const mutableOwners = new WeakSet<Node>();
  const visit = (node: Node): void => {
    if (ast.is.IsVariableDeclaration(node)) {
      const initializer = ast.as.AsVariableDeclaration(node)?.Initializer;
      const type = ast.typeNode(node);
      const carrier = facts.getRuntimeCarrierFact(node)?.carrier;
      if (initializer !== undefined && ast.is.IsArrayLiteralExpression(initializer) &&
        (type === undefined || ast.kindName(type) === "KindArrayType") && isRustVecCarrier(carrier)) {
        const scope = enclosingCallable(node, ast);
        const flow = navigation.expressionValueFlow(initializer);
        const declarations = flow.aliasDeclarations;
        const valid = scope !== undefined && declarations.length > 1 && declarations[0] === node &&
          !flow.captured && !flow.exported && !flow.returned && !flow.yielded && !flow.storedOutsideBinding &&
          declarations.every(declaration => {
            const summary = navigation.declarationUseSummary(declaration);
            const value = ast.as.AsVariableDeclaration(declaration)?.Initializer;
            return ast.is.IsVariableDeclaration(declaration) && value !== undefined &&
              (declaration === node || ast.is.IsIdentifier(value)) && enclosingCallable(declaration, ast) === scope &&
              !summary.bindingWritten && !summary.captured && !summary.exported &&
              facts.getFact(declaration, rustBindingStorageFactKey) === undefined &&
              facts.getFact(declaration, rustNativeArrayStorageKey) === undefined &&
              rustTargetTypeRefEquals(carrier, facts.getRuntimeCarrierFact(declaration)?.carrier);
          }) && flow.uses.every(use => {
            if (use.kind === "type-only" || use.kind === "source-linkage" || use.throughMember) return true;
            if (use.role === "storage") {
              const parent = ast.parent(use.reference);
              return parent !== undefined && declarations.includes(parent) &&
                ast.as.AsVariableDeclaration(parent)?.Initializer === use.reference;
            }
            return use.role === "argument" &&
              ["borrow-shared", "borrow-mut"].includes(facts.getArgumentPassingFact(use.reference)?.mode ?? "");
          });
        if (valid) {
          for (const declaration of declarations) owners.set(declaration, node);
          if (declarations.some(declaration => navigation.declarationUseSummary(declaration).memberWritten ||
            facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined)) mutableOwners.add(node);
        }
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  input.sourceFiles.forEach(visit);
  return Object.freeze({ owner: (declaration: Node) => owners.get(declaration),
    requiresMutableOwner: (declaration: Node) => mutableOwners.has(declaration) });
}

function enclosingCallable(node: Node, ast: AstReader): Node | undefined {
  for (let current = ast.parent(node); current !== undefined; current = ast.parent(current)) {
    if (ast.is.IsFunctionDeclaration(current) || ast.is.IsFunctionExpression(current) || ast.is.IsArrowFunction(current) ||
      ["KindMethodDeclaration", "KindConstructor", "KindGetAccessor", "KindSetAccessor"].includes(ast.kindName(current))) return current;
  }
  return undefined;
}
