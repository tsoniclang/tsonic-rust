import type { Node, SourceFile } from "@tsonic/tsts";
import { KindFunctionDeclaration, KindVariableStatement, Node_Initializer,
  VariableDeclarationList_Declarations, VariableStatement_DeclarationList } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";

import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { requireDenseSourceNodes } from "../source-evidence/dense-nodes.js";
import { rustInheritedProjectConstructor } from "../project-types/inherited-constructors.js";

export function collectRustErrorDeclarations(walk: RustFactWalk, projectSourceFiles: readonly SourceFile[]) {
  const { ast } = walk.context;
  const declarations: Node[] = [];
  const declarationSet = new Set<Node>();
  const regionsByDeclaration = new Map<Node, Set<Node>>();
  const relatedDeclarations = new Map<Node, Set<Node>>();
  const projectImplementations = new Map<Node, Set<Node>>();
  const dependenciesByDeclaration = new Map<Node, Set<Node>>();
  const addDeclaration = (declaration: Node): void => {
    if (!declarationSet.has(declaration)) {
      declarationSet.add(declaration);
      declarations.push(declaration);
    }
  };
  const addRegion = (declaration: Node, region: Node | undefined): void => {
    addDeclaration(declaration);
    if (region === undefined) {
      return;
    }
    const regions = regionsByDeclaration.get(declaration) ?? new Set<Node>();
    regions.add(region);
    regionsByDeclaration.set(declaration, regions);
  };
  const relateDeclarations = (left: Node, right: Node): void => {
    addDeclaration(left);
    addDeclaration(right);
    if (left === right) {
      return;
    }
    const leftRelations = relatedDeclarations.get(left) ?? new Set<Node>();
    const rightRelations = relatedDeclarations.get(right) ?? new Set<Node>();
    leftRelations.add(right);
    rightRelations.add(left);
    relatedDeclarations.set(left, leftRelations);
    relatedDeclarations.set(right, rightRelations);
  };
  const addDeclarationDependency = (declaration: Node, dependency: Node): void => {
    addDeclaration(declaration);
    addDeclaration(dependency);
    const dependencies = dependenciesByDeclaration.get(declaration) ?? new Set<Node>();
    dependencies.add(dependency);
    dependenciesByDeclaration.set(declaration, dependencies);
  };
  const registerCallableDeclaration = (declaration: Node): void => {
    addRegion(declaration, ast.body(declaration));
    const implementation = walk.context.source.navigation.callableImplementation(declaration);
    if (implementation.kind !== "resolved") {
      return;
    }
    const implementationDeclaration = implementation.implementation.declaration;
    addRegion(implementationDeclaration, ast.body(implementationDeclaration));
    relateDeclarations(declaration, implementationDeclaration);
  };
  const callableMemberKind = (node: Node): boolean => {
    const kind = ast.kindName(node);
    return kind === "KindMethodDeclaration" || kind === "KindMethodSignature" ||
      kind === "KindGetAccessor" || kind === "KindSetAccessor";
  };
  for (const producer of walk.context.callableValues.nativeProducers.producers) {
    registerCallableDeclaration(producer.declaration);
  }
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindVariableStatement) {
        const declarations = VariableDeclarationList_Declarations(
          ast,
          VariableStatement_DeclarationList(ast, statement),
        );
        if (declarations === undefined || !isDenseDataArray(declarations)) {
          return;
        }
        for (const declaration of declarations) {
          const binding = declaration === undefined
            ? undefined
            : walk.context.records.moduleBinding.get(declaration);
          if (binding?.storage === "native-callable") {
            addRegion(
              binding.callableDeclaration,
              ast.body(binding.callableDeclaration),
            );
          }
        }
      }
    }
  }
  for (const sourceFile of projectSourceFiles) {
    const visitCallableDeclarations = (node: Node): void => {
      if (!walk.context.isNativeNode(node)) return;
      const operation = walk.context.records.targetOperation.get(node);
      if (ast.kindName(node) === KindFunctionDeclaration || operation?.kind === "closure" ||
        walk.context.sourceCallables.directLexicalBinding(node) !== undefined) {
        registerCallableDeclaration(node);
      }
      if (operation?.kind === "record-literal") {
        for (const contribution of operation.contributions) {
          if (contribution.kind !== "method") {
            continue;
          }
          addRegion(contribution.expression, ast.body(contribution.expression));
          for (const declaration of contribution.contractDeclarations) {
            addDeclarationDependency(declaration, contribution.expression);
          }
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visitCallableDeclarations(child);
        }
      });
    };
    visitCallableDeclarations(sourceFile);
  }
  for (const definition of walk.context.projectTypes.definitions) {
    const members = requireDenseSourceNodes(
      walk,
      ast.members(definition.declaration),
      "Project type declaration contains an undefined or non-data member slot.",
    );
    if (members === undefined) {
      return;
    }
    if (definition.kind === "class") {
      const constructors = members.filter(member => ast.kindName(member) === "KindConstructor");
      const constructorSubject = constructors.find(member => ast.body(member) !== undefined) ?? definition.declaration;
      addDeclaration(constructorSubject);
      for (const constructor of constructors) {
        registerCallableDeclaration(constructor);
        relateDeclarations(constructorSubject, constructor);
      }
      for (const member of members) {
        if (ast.kindName(member) === "KindPropertyDeclaration" && !ast.hasModifierKind(member, "static")) {
          addRegion(constructorSubject, Node_Initializer(ast, member));
        } else if (callableMemberKind(member)) {
          registerCallableDeclaration(member);
        }
      }
    }
    for (const member of members) {
      if (!callableMemberKind(member) || ast.hasModifierKind(member, "static")) {
        continue;
      }
      registerCallableDeclaration(member);
      for (const concrete of walk.context.projectTypes.concreteClassesFor(definition)) {
        const implementation = walk.context.projectTypes.memberImplementation(concrete, member);
        if (implementation.kind !== "resolved") {
          continue;
        }
        const implementationDeclaration = implementation.implementation.declaration;
        addRegion(implementationDeclaration, ast.body(implementationDeclaration));
        relateDeclarations(member, implementationDeclaration);
        if (ast.body(member) === undefined) {
          const implementations = projectImplementations.get(member) ?? new Set<Node>();
          implementations.add(implementationDeclaration);
          projectImplementations.set(member, implementations);
        }
      }
    }
    if (definition.kind === "class") {
      for (const signature of walk.context.projectTypes.constructorsForDefinition(definition)) {
        const inherited = rustInheritedProjectConstructor(
          walk.context.projectTypes,
          definition,
          signature,
        );
        if (inherited !== undefined) {
          addDeclarationDependency(
            definition.declaration,
            inherited.constructor.declaration ?? inherited.base.declaration,
          );
        }
      }
    }
  }
  return Object.freeze({ declarations, regionsByDeclaration, relatedDeclarations, projectImplementations,
    dependenciesByDeclaration, registerCallableDeclaration, isDeclaration: (node: Node) => declarationSet.has(node) });
}
