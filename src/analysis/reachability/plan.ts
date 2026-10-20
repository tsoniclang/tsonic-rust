import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { RustReachabilityInput } from "./model.js";
import type { RustReachability } from "../../target-model/records/reachability.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceUnionDefinitionIdentity } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";

import { analyzeRustGeneratedItemUsage } from "./generated-item-usage.js";
import { transitivelyReachable, projectStandaloneItemEdges, deadComponentRoots } from "./graph.js";

type DeclarationOwner =
  | { readonly kind: "declaration"; readonly declaration: Node }
  | { readonly kind: "erased" }
  | { readonly kind: "root" };

export function analyzeRustReachability(program: RustReachabilityInput, nativeNodes: readonly Node[],
  conversionEmission: import("../program/records/conversion-emission.js").RustConversionEmissionProducer): RustReachability {
  const ast = program.source.ast;
  const nativeNodeSet = new Set(nativeNodes);
  const declarations = collectDeclarationUnits(ast, nativeNodes);
  const declarationSet = new Set(declarations);
  const canonicalByDeclaration = new Map<Node, Node>();
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
  const runtimeInitializationNodes = collectSubtreeNodes(ast, runtimeInitializationRoots, nativeNodeSet);
  const publicDeclarations = new Set<Node>(program.sourcePackageFacades.componentIds.flatMap(
    (componentId) => program.sourcePackageFacades.exportsForComponent(componentId)
      .map((entry) => entry.declaration),
  ));
  const publishesImplementationAbi = (declaration: Node): boolean =>
    declarationIsTopLevel(ast, declaration) &&
    program.sourcePackageComponents.componentForFile(
      ast.getFileName(ast.getSourceFile(declaration)),
    )?.publishesImplementationAbi === true;
  const generatedUsage = analyzeRustGeneratedItemUsage({
    conversionEmission,
    ast,
    sourceFiles: program.sourceFiles,
    nativeNodes,
    declarations,
    records: program.records,
    projectTypes: program.projectTypes,
    classValues: program.classValues,
    sourceCallableSpecializations: program.sourceCallableSpecializations,
    declarationGenericRequirements: program.declarationGenericRequirements,
    typeDefinitions: program.typeDefinitions,
    typeFamilies: program.typeFamilies,
    objectRepresentations: program.objectRepresentations,
    projectMethodProperties: program.projectMethodProperties,
    projectFieldDispatch: program.projectFieldDispatch,
    structuralShapes: program.structuralShapes,
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
    if (publicDeclarations.has(declaration) || publicDeclarations.has(selected) ||
      publishesImplementationAbi(declaration)) {
      externallyReachable.add(selected);
    }
    for (const use of summary.uses) {
      if (use.kind === "source-linkage" || !nativeNodeSet.has(use.reference)) continue;
      const genericImplementation = program.callableValues.generic.implementationFor(selected);
      if (use.kind === "first-class" && genericImplementation?.creation === "declaration" &&
        !program.callableValues.genericDispatch.usesDeclarationBody(selected)) continue;
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
      if (use.kind === "type-only" && owner.kind === "declaration" &&
        !runtimeUnionUsesDeclaration(owner.declaration, selected, program)) continue;
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

  for (const use of program.generatedDeclarationUses) {
    if (!nativeNodeSet.has(use.reference)) continue;
    const owner: DeclarationOwner = runtimeInitializationNodes.has(use.reference)
      ? { kind: "root" }
      : enclosingDeclarationOwner(
          ast,
          use.reference,
          "direct-call",
          declarationSet,
          graphUnits,
          itemUnits,
          canonical,
        );
    if (owner.kind !== "erased") {
      addEdge(owner.kind === "root" ? undefined : owner.declaration, use.declaration);
    }
  }

  for (const definition of program.projectTypes.definitions) {
    const selected = canonical(definition.declaration);
    if (graphUnits.has(selected) && generatedUsage.usedProjectTypes.has(definition.declaration)) {
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
  const suppressedDeclarations = new Set(suppressionRoots);
  const readAuthoredFields = new Set(generatedUsage.readAuthoredFields);
  for (const declaration of declarations) {
    const selected = canonical(declaration);
    if (externallyReachable.has(selected)) externallyReachable.add(declaration);
    if (suppressionRoots.has(selected)) suppressedDeclarations.add(declaration);
    if (generatedUsage.readAuthoredFields.has(selected)) readAuthoredFields.add(declaration);
  }
  return Object.freeze({ ...generatedUsage, externallyReachable, suppressedDeclarations, readAuthoredFields });
}

function declarationParticipatesInRustLiveness(
  declaration: Node,
  program: RustReachabilityInput,
): boolean {
  if (program.records.compileTimeSource.get(declaration)) return false;
  if (program.records.typeOnlyDeclaration.get(declaration) !== undefined) return false;
  return program.source.ast.kindName(declaration) !== "KindTypeAliasDeclaration" ||
    program.records.typeAliasDeclaration.get(declaration)?.kind !== "erased";
}

function runtimeUnionUsesDeclaration(owner: Node, target: Node, program: RustReachabilityInput): boolean {
  const fact = program.records.typeAliasDeclaration.get(owner);
  const targetFact = program.records.typeAliasDeclaration.get(target);
  if (fact?.kind !== "runtime" || targetFact?.kind !== "runtime") return true;
  const carrier = program.records.runtimeCarrier.get(target)?.carrier;
  const identity = carrier === undefined ? undefined : rustSourceUnionDefinitionIdentity(carrier);
  if (identity === undefined) return true;
  const pending = fact.variants.map(variant => variant.carrier);
  const visited = new Set<TargetTypeRef>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (rustSourceUnionDefinitionIdentity(current) === identity) return true;
    pending.push(...rustTargetTypeChildren(current));
  }
  return false;
}

function declarationEmitsStandaloneRustItem(
  declaration: Node,
  program: RustReachabilityInput,
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

function collectSubtreeNodes(ast: AstReader, roots: readonly Node[], nativeNodes: ReadonlySet<Node>): WeakSet<Node> {
  const nodes = new WeakSet<Node>();
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (nodes.has(node) || !nativeNodes.has(node)) continue;
    nodes.add(node);
    ast.forEachChild(node, (child) => {
      if (child !== undefined) pending.push(child);
    });
  }
  return nodes;
}

function collectDeclarationUnits(
  ast: AstReader,
  nativeNodes: readonly Node[],
): readonly Node[] {
  const byFile = new Map<SourceFile, Node[]>();
  for (const node of nativeNodes) {
    if (!isDeclarationUnit(ast, node)) continue;
    const file = ast.getSourceFile(node);
    if (file === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native declaration requires its exact checked source file.");
    const declarations = byFile.get(file) ?? [];
    declarations.push(node);
    byFile.set(file, declarations);
  }
  return Object.freeze([...byFile].sort(([left], [right]) =>
    ast.getFileName(left).localeCompare(ast.getFileName(right), "en")).flatMap(([, declarations]) => declarations));
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
