import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import { rustTypeAliasDeclarationFactKey } from "../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  analyzeRustGeneratedItemUsage,
} from "./generated-item-usage.js";
import type {
  RustDispatchMemberRole,
  RustGeneratedItemUsage,
  RustGeneratedProjectFieldRole,
} from "./generated-item-usage.js";

export interface RustPlannerLiveness {
  isExternallyReachable(declaration: Node): boolean;
  requiresSuppression(declaration: Node): boolean;
  isRead(declaration: Node): boolean;
  isProjectTypeConstructed(declaration: Node): boolean;
  isProjectConstructorInvoked(declaration: Node): boolean;
  isProjectGeneratedFieldUsed(
    declaration: Node,
    role: RustGeneratedProjectFieldRole,
  ): boolean;
  isDispatchMemberUsed(declaration: Node, role: RustDispatchMemberRole): boolean;
  isDowncastUsed(source: Node, target: Node): boolean;
  isStructuralFieldRead(carrier: TargetTypeRef, storageIndex: number): boolean;
  isStructuralFieldWritten(carrier: TargetTypeRef, storageIndex: number): boolean;
  isStructuralShapeConstructed(carrier: TargetTypeRef): boolean;
  isVariantConstructed(declaration: Node, variantName: string): boolean;
}

type DeclarationOwner =
  | { readonly kind: "declaration"; readonly declaration: Node }
  | { readonly kind: "erased" }
  | { readonly kind: "root" };

export function createRustPlannerLiveness(program: RustTargetProgram): RustPlannerLiveness {
  const ast = program.source.ast;
  const declarations = collectDeclarationUnits(ast, program.sourceFiles);
  const declarationSet = new Set(declarations);
  const canonicalByDeclaration = new WeakMap<Node, Node>();
  const canonical = (declaration: Node): Node => {
    const existing = canonicalByDeclaration.get(declaration);
    if (existing !== undefined) return existing;
    const implementation = isCallableDeclaration(ast, declaration)
      ? program.sourceNavigation.callableImplementation(declaration)
      : undefined;
    const selected = implementation?.kind === "resolved"
      ? implementation.implementation.declaration
      : declaration;
    canonicalByDeclaration.set(declaration, selected);
    return selected;
  };
  const participates = (declaration: Node): boolean =>
    declarationParticipatesInRustLiveness(declaration, program);
  const graphUnits = new Set(declarations.filter(participates).map(canonical));
  const itemUnits = new Set(declarations
    .filter((declaration) => declarationEmitsStandaloneRustItem(declaration, program))
    .map(canonical));
  const order = new Map<Node, number>();
  for (const declaration of declarations) {
    const selected = canonical(declaration);
    if (itemUnits.has(selected) && !order.has(selected)) order.set(selected, order.size);
  }

  const edges = new Map<Node, Set<Node>>();
  const roots = new Set<Node>();
  const externallyReachable = new Set<Node>();
  const runtimeInitializationRoots = program.sourceFiles.filter((sourceFile) =>
    program.moduleInitialization.requirementFor(sourceFile).kind === "required");
  const runtimeInitializationNodes = collectSubtreeNodes(ast, runtimeInitializationRoots);
  const publicDeclarations = new Set<Node>(program.sourcePackageFacades.componentIds.flatMap(
    (componentId) => program.sourcePackageFacades.exportsForComponent(componentId)
      .map((entry) => entry.declaration),
  ));
  const generatedUsage = analyzeRustGeneratedItemUsage({
    ast,
    sourceFiles: program.sourceFiles,
    declarations,
    facts: program.facts,
    projectTypes: program.projectTypes,
    objectRepresentations: program.objectRepresentations,
    projectMethodProperties: program.projectMethodProperties,
    projectFieldDispatch: program.projectFieldDispatch,
    navigation: program.sourceNavigation,
  });

  const addEdge = (owner: Node | undefined, target: Node): void => {
    const selectedTarget = canonical(target);
    if (!graphUnits.has(selectedTarget)) return;
    if (owner === undefined) {
      roots.add(selectedTarget);
      return;
    }
    const selectedOwner = canonical(owner);
    if (!graphUnits.has(selectedOwner)) return;
    const owned = edges.get(selectedOwner) ?? new Set<Node>();
    owned.add(selectedTarget);
    edges.set(selectedOwner, owned);
  };

  for (const declaration of declarations) {
    const selected = canonical(declaration);
    if (!graphUnits.has(selected)) continue;
    const summary = program.sourceNavigation.declarationUseSummary(declaration);
    if (publicDeclarations.has(declaration) || publicDeclarations.has(selected)) {
      externallyReachable.add(selected);
    }
    for (const use of summary.uses) {
      if (use.kind === "source-linkage") continue;
      const owner: DeclarationOwner = runtimeInitializationNodes.has(use.reference)
        ? { kind: "root" }
        : enclosingDeclarationOwner(
            ast,
            use.reference,
            use.kind,
            declarationSet,
            graphUnits,
            itemUnits,
            canonical,
          );
      if (owner.kind === "erased") continue;
      addEdge(owner.kind === "root" ? undefined : owner.declaration, selected);
      if (ast.kindName(selected) === "KindClassDeclaration" &&
        isConstructionReference(ast, use.reference, use.role)) {
        for (const member of ast.members(selected)) {
          if (member === undefined) continue;
          const kind = ast.kindName(member);
          if (kind === "KindConstructor" ||
            kind === "KindPropertyDeclaration" &&
              !ast.hasModifierKind(member, "static") &&
              Node_Initializer(ast, member) !== undefined) {
            addEdge(owner.kind === "root" ? undefined : owner.declaration, member);
          }
        }
      }
    }
  }

  for (const definition of program.projectTypes.definitions) {
    const selected = canonical(definition.declaration);
    if (graphUnits.has(selected) && generatedUsage.isProjectTypeUsed(definition.declaration)) {
      roots.add(selected);
    }
  }

  let externalMemberAdded = true;
  while (externalMemberAdded) {
    externalMemberAdded = false;
    for (const declaration of declarations) {
      const selected = canonical(declaration);
      if (!graphUnits.has(selected) || externallyReachable.has(selected) ||
        ast.hasModifierKind(declaration, "private") ||
        ast.hasModifierKind(declaration, "protected")) {
        continue;
      }
      const owner = enclosingMemberOwner(ast, declaration, declarationSet, canonical);
      if (owner !== undefined && externallyReachable.has(owner)) {
        externallyReachable.add(selected);
        externalMemberAdded = true;
      }
    }
  }
  for (const declaration of externallyReachable) roots.add(declaration);

  const reachable = transitivelyReachable(roots, edges);
  const itemEdges = projectStandaloneItemEdges(itemUnits, graphUnits, edges);
  const suppressionRoots = deadComponentRoots(itemUnits, reachable, itemEdges, order);
  return Object.freeze({
    isExternallyReachable: (declaration: Node) =>
      externallyReachable.has(canonical(declaration)),
    requiresSuppression: (declaration: Node) =>
      suppressionRoots.has(canonical(declaration)),
    isRead: (declaration: Node) =>
      generatedUsage.isAuthoredFieldRead(canonical(declaration)),
    isProjectTypeConstructed: generatedUsage.isProjectTypeConstructed,
    isProjectConstructorInvoked: generatedUsage.isProjectConstructorInvoked,
    isProjectGeneratedFieldUsed: generatedUsage.isProjectGeneratedFieldUsed,
    isDispatchMemberUsed: generatedUsage.isDispatchMemberUsed,
    isDowncastUsed: generatedUsage.isDowncastUsed,
    isStructuralFieldRead: generatedUsage.isStructuralFieldRead,
    isStructuralFieldWritten: generatedUsage.isStructuralFieldWritten,
    isStructuralShapeConstructed: generatedUsage.isStructuralShapeConstructed,
    isVariantConstructed: generatedUsage.isVariantConstructed,
  });
}

function declarationParticipatesInRustLiveness(
  declaration: Node,
  program: RustTargetProgram,
): boolean {
  return program.source.ast.kindName(declaration) !== "KindTypeAliasDeclaration" ||
    program.facts.getFact(declaration, rustTypeAliasDeclarationFactKey)?.kind !== "erased";
}

function declarationEmitsStandaloneRustItem(
  declaration: Node,
  program: RustTargetProgram,
): boolean {
  if (!declarationParticipatesInRustLiveness(declaration, program)) return false;
  switch (program.source.ast.kindName(declaration)) {
    case "KindPropertyDeclaration":
    case "KindPropertySignature":
    case "KindMethodSignature":
      return false;
    default:
      return true;
  }
}

function collectSubtreeNodes(ast: AstReader, roots: readonly Node[]): WeakSet<Node> {
  const nodes = new WeakSet<Node>();
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (nodes.has(node)) continue;
    nodes.add(node);
    ast.forEachChild(node, (child) => {
      if (child !== undefined) pending.push(child);
    });
  }
  return nodes;
}

function collectDeclarationUnits(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): readonly Node[] {
  const declarations: Node[] = [];
  const pending: Node[] = [...sourceFiles]
    .sort((left, right) => ast.getFileName(right).localeCompare(ast.getFileName(left), "en"));
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (isDeclarationUnit(ast, node)) declarations.push(node);
    const children: Node[] = [];
    ast.forEachChild(node, (child) => {
      if (child !== undefined) children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]!);
    }
  }
  return Object.freeze(declarations);
}

function isDeclarationUnit(ast: AstReader, node: Node): boolean {
  switch (ast.kindName(node)) {
    case "KindFunctionDeclaration":
    case "KindClassDeclaration":
    case "KindInterfaceDeclaration":
    case "KindTypeAliasDeclaration":
    case "KindEnumDeclaration":
    case "KindMethodDeclaration":
    case "KindMethodSignature":
    case "KindConstructor":
    case "KindGetAccessor":
    case "KindSetAccessor":
    case "KindPropertyDeclaration":
    case "KindPropertySignature":
      return true;
    case "KindVariableDeclaration":
      return declarationIsTopLevel(ast, node);
    default:
      return false;
  }
}

function isCallableDeclaration(ast: AstReader, node: Node): boolean {
  switch (ast.kindName(node)) {
    case "KindFunctionDeclaration":
    case "KindMethodDeclaration":
    case "KindMethodSignature":
    case "KindConstructor":
    case "KindGetAccessor":
    case "KindSetAccessor":
      return true;
    default:
      return false;
  }
}

function declarationIsTopLevel(ast: AstReader, declaration: Node): boolean {
  let current = ast.parent(declaration);
  while (current !== undefined) {
    if (ast.is.IsSourceFile(current)) return true;
    if (isDeclarationUnit(ast, current)) return false;
    current = ast.parent(current);
  }
  return false;
}

function enclosingDeclarationOwner(
  ast: AstReader,
  reference: Node,
  useKind: "direct-call" | "first-class" | "type-only",
  declarations: ReadonlySet<Node>,
  graphUnits: ReadonlySet<Node>,
  itemUnits: ReadonlySet<Node>,
  canonical: (declaration: Node) => Node,
): DeclarationOwner {
  let current = ast.parent(reference);
  while (current !== undefined) {
    if (declarations.has(current)) {
      const selected = canonical(current);
      if (!graphUnits.has(selected)) return { kind: "erased" };
      if (itemUnits.has(selected) || useKind !== "type-only") {
        return { kind: "declaration", declaration: selected };
      }
      const owner = enclosingMemberOwner(ast, current, declarations, canonical);
      return owner !== undefined && itemUnits.has(owner)
        ? { kind: "declaration", declaration: owner }
        : { kind: "declaration", declaration: selected };
    }
    if (ast.is.IsSourceFile(current)) return { kind: "root" };
    current = ast.parent(current);
  }
  return { kind: "root" };
}

function projectStandaloneItemEdges(
  itemUnits: ReadonlySet<Node>,
  graphUnits: ReadonlySet<Node>,
  edges: ReadonlyMap<Node, ReadonlySet<Node>>,
): ReadonlyMap<Node, ReadonlySet<Node>> {
  const projected = new Map<Node, Set<Node>>();
  for (const owner of itemUnits) {
    const targets = new Set<Node>();
    const visited = new Set<Node>();
    const pending = [...(edges.get(owner) ?? [])];
    while (pending.length > 0) {
      const target = pending.pop()!;
      if (!graphUnits.has(target) || visited.has(target)) continue;
      visited.add(target);
      if (itemUnits.has(target)) {
        targets.add(target);
        continue;
      }
      for (const dependency of edges.get(target) ?? []) pending.push(dependency);
    }
    if (targets.size > 0) projected.set(owner, targets);
  }
  return projected;
}

function enclosingMemberOwner(
  ast: AstReader,
  declaration: Node,
  declarations: ReadonlySet<Node>,
  canonical: (declaration: Node) => Node,
): Node | undefined {
  const kind = ast.kindName(declaration);
  if (kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature" &&
    kind !== "KindConstructor" && kind !== "KindGetAccessor" &&
    kind !== "KindSetAccessor" && kind !== "KindPropertyDeclaration" &&
    kind !== "KindPropertySignature") {
    return undefined;
  }
  let current = ast.parent(declaration);
  while (current !== undefined) {
    if (declarations.has(current)) return canonical(current);
    current = ast.parent(current);
  }
  return undefined;
}

function isConstructionReference(
  ast: AstReader,
  reference: Node,
  role: string,
): boolean {
  if (role !== "call-target") return false;
  let current: Node | undefined = reference;
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (kind === "KindNewExpression") return true;
    if (isDeclarationUnit(ast, current) || ast.is.IsSourceFile(current)) return false;
    current = ast.parent(current);
  }
  return false;
}

function transitivelyReachable(
  roots: ReadonlySet<Node>,
  edges: ReadonlyMap<Node, ReadonlySet<Node>>,
): ReadonlySet<Node> {
  const reachable = new Set<Node>();
  const pending = [...roots];
  while (pending.length > 0) {
    const declaration = pending.pop()!;
    if (reachable.has(declaration)) continue;
    reachable.add(declaration);
    for (const dependency of edges.get(declaration) ?? []) {
      if (!reachable.has(dependency)) pending.push(dependency);
    }
  }
  return reachable;
}

function deadComponentRoots(
  units: ReadonlySet<Node>,
  reachable: ReadonlySet<Node>,
  edges: ReadonlyMap<Node, ReadonlySet<Node>>,
  order: ReadonlyMap<Node, number>,
): ReadonlySet<Node> {
  const position = (node: Node): number => order.get(node) ?? 0;
  const dead = [...units]
    .filter((declaration) => !reachable.has(declaration))
    .sort((left, right) => position(left) - position(right));
  const deadSet = new Set(dead);
  const reverse = new Map<Node, Set<Node>>();
  for (const owner of dead) {
    for (const target of edges.get(owner) ?? []) {
      if (!deadSet.has(target)) continue;
      const owners = reverse.get(target) ?? new Set<Node>();
      owners.add(owner);
      reverse.set(target, owners);
    }
  }

  const finishOrder: Node[] = [];
  const visited = new Set<Node>();
  for (const start of dead) {
    if (visited.has(start)) continue;
    const stack: { readonly node: Node; readonly expanded: boolean }[] = [{
      node: start,
      expanded: false,
    }];
    while (stack.length > 0) {
      const entry = stack.pop()!;
      if (entry.expanded) {
        finishOrder.push(entry.node);
        continue;
      }
      if (visited.has(entry.node)) continue;
      visited.add(entry.node);
      stack.push({ node: entry.node, expanded: true });
      const dependencies = [...(edges.get(entry.node) ?? [])]
        .filter((dependency) => deadSet.has(dependency))
        .sort((left, right) => position(right) - position(left));
      for (const dependency of dependencies) {
        if (!visited.has(dependency)) stack.push({ node: dependency, expanded: false });
      }
    }
  }

  const componentByNode = new Map<Node, number>();
  const components: Node[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index]!;
    if (componentByNode.has(start)) continue;
    const componentIndex = components.length;
    const component: Node[] = [];
    const pending = [start];
    componentByNode.set(start, componentIndex);
    while (pending.length > 0) {
      const node = pending.pop()!;
      component.push(node);
      for (const owner of reverse.get(node) ?? []) {
        if (!componentByNode.has(owner)) {
          componentByNode.set(owner, componentIndex);
          pending.push(owner);
        }
      }
    }
    component.sort((left, right) => position(left) - position(right));
    components.push(component);
  }

  const incoming = new Array<number>(components.length).fill(0);
  for (const owner of dead) {
    const ownerComponent = componentByNode.get(owner);
    for (const target of edges.get(owner) ?? []) {
      if (!deadSet.has(target)) continue;
      const targetComponent = componentByNode.get(target);
      if (targetComponent !== undefined && targetComponent !== ownerComponent) {
        incoming[targetComponent] = (incoming[targetComponent] ?? 0) + 1;
      }
    }
  }
  return new Set(components.flatMap((component, index) =>
    incoming[index] === 0 && component[0] !== undefined ? [component[0]] : []));
}

export type { RustGeneratedItemUsage };
