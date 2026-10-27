import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { RustRuntimeValueUsePlan } from "../program/runtime-value-uses.js";
import { rustSourceValueWrapperContains } from "../../policy/ownership/source-value-wrappers.js";
import type { RustReachabilityInput } from "./model.js";
import type { RustReachability } from "../../target-model/records/program/reachability.js";

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
  conversionEmission: import("../program/records/operations/conversion-emission.js").RustConversionEmissionProducer,
  semanticsFor: (node: Node) => SourceFileSemantics, runtimeValueUses: RustRuntimeValueUsePlan): RustReachability {
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
  const promiseObjectUses: { readonly owner: Node | undefined; readonly declaration: Node }[] = [];
  const promiseDeclaration = (declaration: Node): Node | undefined => {
    if (program.promiseBodies.objects.has(declaration)) return declaration;
    const binding = program.records.moduleBinding.get(declaration);
    return binding?.storage === "native-callable" && program.promiseBodies.objects.has(binding.callableDeclaration)
      ? binding.callableDeclaration : undefined;
  };
  const usesPromiseObject = (reference: Node, declaration: Node): boolean => {
    if (ast.is.IsCallExpression(reference)) {
      const operation = program.records.targetOperation.get(reference);
      return operation?.kind !== "source-call" || operation.asyncBody?.declaration !== declaration;
    }
    let value = reference;
    let parent = ast.parent(value);
    while (parent !== undefined && (rustSourceValueWrapperContains(parent, value, ast) ||
      ast.is.IsPropertyAccessExpression(parent) && ast.name(parent) === value)) {
      value = parent;
      parent = ast.parent(value);
    }
    if (parent !== undefined && ast.is.IsCallExpression(parent) && Node_Expression(ast, parent) === value) {
      const operation = program.records.targetOperation.get(parent);
      if (operation?.kind === "source-call" && operation.asyncBody?.declaration === declaration) return false;
    }
    return parent === undefined || !ast.is.IsVariableDeclaration(parent) || Node_Initializer(ast, parent) !== value ||
      runtimeValueUses.promiseCallAliasTarget(parent) !== declaration;
  };
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

  const useSubjects = new Set(declarations);
  for (const declaration of declarations) {
    if (!isCallableDeclaration(ast, declaration)) continue;
    const implementation = program.sourceNavigation.callableImplementation(declaration);
    if (implementation.kind !== "resolved" || implementation.implementation.symbol === undefined) continue;
    const semantics = semanticsFor(declaration);
    for (const contract of semantics.declarations.symbolDeclarations(implementation.implementation.symbol)) {
      if (contract !== undefined && isCallableDeclaration(ast, contract) && canonical(contract) === canonical(declaration)) {
        useSubjects.add(contract);
      }
    }
  }

  for (const declaration of useSubjects) {
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
      const promise = promiseDeclaration(selected);
      if (promise !== undefined && use.kind !== "type-only" && runtimeValueUses.isRuntimeReference(declaration, use.reference) &&
        usesPromiseObject(use.reference, promise)) promiseObjectUses.push({
          owner: owner.kind === "root" ? undefined : canonical(owner.declaration), declaration: promise,
        });
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
      const promise = promiseDeclaration(canonical(use.declaration));
      if (promise !== undefined && usesPromiseObject(use.reference, promise)) promiseObjectUses.push({
        owner: owner.kind === "root" ? undefined : canonical(owner.declaration), declaration: promise,
      });
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
  const usedPromiseObjects = new Set<Node>();
  for (const declaration of externallyReachable) {
    const promise = promiseDeclaration(declaration);
    if (promise !== undefined) usedPromiseObjects.add(promise);
  }
  for (const use of promiseObjectUses)
    if (use.owner === undefined || reachable.has(use.owner)) usedPromiseObjects.add(use.declaration);
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
  return Object.freeze({ ...generatedUsage, externallyReachable, suppressedDeclarations, readAuthoredFields, usedPromiseObjects });
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

// The nodes evaluated by module initialization: callable bodies (functions, methods, accessors, constructors and
// callable values that are not invoked in place) run only when called, so their uses belong to their declaration.
function collectSubtreeNodes(ast: AstReader, roots: readonly Node[], nativeNodes: ReadonlySet<Node>): WeakSet<Node> {
  const nodes = new WeakSet<Node>();
  const pending = [...roots];
  const invokedInPlace = (node: Node): boolean => {
    let callee = node;
    let parent = ast.parent(node);
    while (parent !== undefined && ast.is.IsParenthesizedExpression(parent)) {
      callee = parent;
      parent = ast.parent(parent);
    }
    return parent !== undefined && ast.is.IsCallExpression(parent) && Node_Expression(ast, parent) === callee;
  };
  const deferredBody = (node: Node): boolean => ast.is.IsFunctionDeclaration(node) || ast.is.IsMethodDeclaration(node) ||
    ast.is.IsConstructorDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node) ||
    (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) && !invokedInPlace(node);
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (nodes.has(node) || !nativeNodes.has(node) || deferredBody(node)) continue;
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
