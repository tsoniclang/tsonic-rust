import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceFileSemantics, SourceProgramNavigation } from "@tsonic/target-api/source";
import { createTargetGraphComponentQuery, type SourceStorageBudget } from "@tsonic/target-api/analysis";
import type { RustProjectTypePolicy } from "./index.js";

export interface RustProjectMethodPropertyUsage {
  readonly declaration: Node;
  readonly readable: boolean;
  readonly writable: boolean;
}

export interface RustProjectMethodPropertyPlan {
  readonly usages: readonly RustProjectMethodPropertyUsage[];
  usageFor(declaration: Node): RustProjectMethodPropertyUsage | undefined;
}

export interface RustProjectMethodPropertyPlanRegistry extends RustProjectMethodPropertyPlan {
  initialize(input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
    readonly projectTypes: RustProjectTypePolicy;
    readonly semanticsFor: (node: Node) => SourceFileSemantics;
    readonly isRuntimeReference: (declaration: Node, reference: Node) => boolean;
    readonly budget: SourceStorageBudget;
  }): { readonly kind: "resolved"; readonly value: RustProjectMethodPropertyPlan } |
    { readonly kind: "unresolved"; readonly reason: string };
  seal(): RustProjectMethodPropertyPlan;
}

interface UsageInput {
  readable: boolean;
  writable: boolean;
  readonly predecessors: Set<Node>;
}

export function createRustProjectMethodPropertyPlanRegistry(): RustProjectMethodPropertyPlanRegistry {
  let current: RustProjectMethodPropertyPlan | undefined;
  let initialized = false;
  const requireCurrent = (): RustProjectMethodPropertyPlan => {
    if (current === undefined) {
      failTargetAnalysisInvariant("tsonic-rust", "Rust project method-property plan was read before source analysis initialized it.");
    }
    return current;
  };
  return Object.freeze({
    get usages() { return requireCurrent().usages; },
    initialize(input: Parameters<RustProjectMethodPropertyPlanRegistry["initialize"]>[0]) {
      if (initialized) failTargetAnalysisInvariant("tsonic-rust", "Rust project method-property plan can be initialized only once.");
      initialized = true;
      const { ast, navigation, projectTypes, budget } = input;
      const unresolved = () => Object.freeze({ kind: "unresolved" as const,
        reason: budget.failure() ?? "Project method-property usage exceeds its finite work budget." });
      const inputs = new Map<Node, UsageInput>();
      const admit = (declaration: Node): UsageInput | undefined => {
        const existing = inputs.get(declaration);
        if (existing !== undefined) return existing;
        if (!budget.node()) return undefined;
        const selected: UsageInput = { readable: false, writable: false, predecessors: new Set() };
        inputs.set(declaration, selected);
        return selected;
      };
      const connect = (source: Node, destination: Node): boolean => {
        if (!budget.step()) return false;
        const selected = admit(destination);
        if (admit(source) === undefined || selected === undefined) return false;
        if (selected.predecessors.has(source)) return true;
        if (!budget.edge()) return false;
        selected.predecessors.add(source);
        return true;
      };
      const canonical = (declaration: Node): Node => {
        const implementation = navigation.callableImplementation(declaration);
        return implementation.kind === "resolved" ? implementation.implementation.declaration : declaration;
      };
      for (const definition of projectTypes.definitions) {
        if (!budget.step()) return unresolved();
        for (const declaration of ast.members(definition.declaration)) {
          if (!budget.step()) return unresolved();
          if (declaration === undefined || !isInstanceMethod(declaration, ast)) continue;
          const selected = admit(declaration);
          if (selected === undefined) return unresolved();
          const implementation = canonical(declaration);
          if (!connect(declaration, implementation) || !connect(implementation, declaration)) return unresolved();
          for (const concrete of projectTypes.concreteClassesFor(definition)) {
            if (!budget.step()) return unresolved();
            const inherited = projectTypes.memberImplementation(concrete, declaration);
            if (inherited.kind === "resolved" &&
              !connect(declaration, inherited.implementation.declaration)) return unresolved();
          }
          for (const use of navigation.declarationUses(declaration)) {
            if (!budget.step()) return unresolved();
            if (use.kind !== "first-class" || !input.isRuntimeReference(declaration, use.reference)) continue;
            const access = methodAccessForReference(ast, use.reference);
            if (access === undefined) continue;
            const operations = input.semanticsFor(access).operations;
            const checked = ast.is.IsPropertyAccessExpression(access)
              ? operations.propertyAccess(access) : operations.elementAccess(access);
            if (checked === undefined) continue;
            const owner = checked.selectedDeclaration;
            if (owner === undefined || owner !== declaration && canonical(owner) !== implementation ||
              checked.accessMode === "delete") continue;
            selected.readable ||= checked.accessMode === "read" || checked.accessMode === "read-write";
            selected.writable ||= checked.accessMode === "write" || checked.accessMode === "read-write";
          }
        }
      }
      const select = createTargetGraphComponentQuery<Node, UsageInput,
        Readonly<Pick<RustProjectMethodPropertyUsage, "readable" | "writable">>>(
        declaration => {
          if (!budget.step()) return undefined;
          const selected = inputs.get(declaration);
          return selected === undefined ? undefined : { data: selected, neighbours: selected.predecessors };
        }, members => {
          let readable = false;
          let writable = false;
          for (const member of members) {
            if (!budget.step()) return undefined;
            readable ||= member.data.readable;
            writable ||= member.data.writable;
            for (const predecessor of member.successors) {
              if (!budget.step()) return undefined;
              readable ||= predecessor.readable;
              writable ||= predecessor.writable;
            }
          }
          return Object.freeze({ readable, writable });
        }, budget);
      const usages: RustProjectMethodPropertyUsage[] = [];
      for (const declaration of inputs.keys()) {
        const flags = select(declaration);
        if (flags === undefined) return unresolved();
        if (flags.readable || flags.writable) usages.push(Object.freeze({ declaration, ...flags }));
      }
      usages.sort((left, right) => {
        const leftFile = ast.getFileName(ast.getSourceFile(left.declaration));
        const rightFile = ast.getFileName(ast.getSourceFile(right.declaration));
        return leftFile.localeCompare(rightFile, "en") || ast.pos(left.declaration) - ast.pos(right.declaration);
      });
      const byDeclaration = new Map(usages.map(usage => [usage.declaration, usage]));
      current = Object.freeze({ usages: Object.freeze(usages),
        usageFor: (declaration: Node) => byDeclaration.get(declaration) });
      return Object.freeze({ kind: "resolved" as const, value: current });
    },
    seal: requireCurrent,
    usageFor: (declaration: Node) => requireCurrent().usageFor(declaration),
  });
}

function isInstanceMethod(declaration: Node, ast: AstReader): boolean {
  return (ast.is.IsMethodDeclaration(declaration) || ast.kindName(declaration) === "KindMethodSignature") &&
    !ast.hasModifierKind(declaration, "static");
}

function methodAccessForReference(ast: AstReader, reference: Node): Node | undefined {
  if (ast.is.IsPropertyAccessExpression(reference) || ast.is.IsElementAccessExpression(reference)) return reference;
  const parent = ast.parent(reference);
  return parent !== undefined && (ast.is.IsPropertyAccessExpression(parent) && ast.name(parent) === reference ||
    ast.is.IsElementAccessExpression(parent) && ast.as.AsElementAccessExpression(parent)?.ArgumentExpression === reference)
    ? parent : undefined;
}
