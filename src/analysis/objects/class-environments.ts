import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustFactWalk } from "../program/walk.js";
import { collectRustLexicalCaptures } from "../callables/values/closures.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustSnakeCaseIdentifier } from "../../target-model/names/identifiers.js";
import { Node_Initializer, sourceClassFieldIsTypeOnly } from "@tsonic/target-api/source";
import { selectRustClassEnvironmentStorage } from "../../policy/ownership/retained-storage.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";

import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";
import { isRustDeclarationPathUse } from "../declarations/generic-reference-uses.js";

export function recordRustClassEnvironmentDemands(walk: RustFactWalk): void {
  const { ast, records, projectTypes, classValues } = walk.context;
  const visited = new Set<TargetTypeRef>();
  const record = (carrier: TargetTypeRef | undefined): void => {
    if (carrier === undefined || visited.has(carrier)) return;
    visited.add(carrier);
    const instance = rustClassConstructorInstance(carrier);
    if (instance !== undefined) {
      const definition = projectTypes.definitionForCarrier(instance);
      if (definition !== undefined) classValues.recordConstructorValue(definition.declaration, "type");
    }
    for (const child of rustTargetTypeChildren(carrier)) record(child);
  };
  const visit = (node: Node): void => {
    if (!walk.context.isNativeNode(node)) return;
    const parent = ast.parent(node);
    const declarationName = parent !== undefined && ast.name(parent) === node;
    if (!ast.is.IsClassDeclaration(node) && !declarationName && !isRustDeclarationPathUse(node, ast, records)) {
      record(records.runtimeCarrier.get(node)?.carrier);
    }
    record(records.sourceCallableReturn.get(node)?.returnCarrier);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of walk.context.sourceFiles) visit(sourceFile);
}

import type { RustClassEnvironment } from "../../target-model/records/class-values.js";

export type RustClassEnvironmentSelection =
  | { readonly kind: "none" }
  | { readonly kind: "available"; readonly environment: RustClassEnvironment }
  | { readonly kind: "unresolved"; readonly reason: string };

export function selectRustClassEnvironment(walk: RustFactWalk, declaration: Node): RustClassEnvironmentSelection {
  const { ast, projectTypes, names, records } = walk.context;
  const definition = projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "class") return { kind: "none" };
  const moduleClass = ast.parent(declaration) === ast.getSourceFile(declaration);
  const constructorValue = walk.context.classValues.hasConstructorValue(declaration);
  if (moduleClass && !constructorValue) return { kind: "none" };
  const captureRoots = ast.members(declaration).filter((member): member is Node => member !== undefined &&
    !(ast.hasModifierKind(member, "static") && ast.kindName(member) === "KindPropertyDeclaration"));
  const selected = moduleClass ? { receivers: [], receiverFields: [], captures: [], recursiveDeclaration: undefined } : collectRustLexicalCaptures(walk, declaration, captureRoots);
  if (selected === undefined || selected.recursiveDeclaration !== undefined) {
    return { kind: "unresolved", reason: "Class captures require exact lexical binding and storage facts." };
  }
  const fieldNames = new Set<string>([projectTypes.stateMarkerFieldName(definition)]);
  const captures = selected.captures.map(capture => ({ ...capture,
    fieldName: allocateRustGeneratedName(fieldNames, rustSnakeCaseIdentifier(
      names.nameForDeclaration(capture.declaration) ?? "capture")),
  }));
  const staticFields: RustClassEnvironment["staticFields"][number][] = [];
  for (const member of ast.members(declaration)) {
    if (member === undefined) return { kind: "unresolved", reason: "Class environment has an absent authored member." };
    if (!ast.hasModifierKind(member, "static") || sourceClassFieldIsTypeOnly(ast, member) ||
      ast.kindName(member) !== "KindPropertyDeclaration" || moduleClass) continue;
    if (Node_Initializer(ast, member) === undefined) {
      return { kind: "unresolved", reason: "Local static fields require an exact authored initializer." };
    }
    const carrier = records.runtimeCarrier.get(member)?.carrier;
    const name = names.nameForDeclaration(member);
    if (carrier === undefined || name === undefined) {
      return { kind: "unresolved", reason: "Class static storage requires a finalized carrier and declaration name." };
    }
    staticFields.push({ declaration: member, carrier,
      fieldName: allocateRustGeneratedName(fieldNames, rustSnakeCaseIdentifier(name)),
      readonly: ast.hasModifierKind(member, "readonly"),
    });
  }
  if (captures.length === 0 && staticFields.length === 0 && !constructorValue) return { kind: "none" };
  const capturedDeclarations = new Set(captures.map(capture => capture.declaration));
  const constructorReferences = new Set(walk.context.source.navigation.declarationUses(declaration)
    .filter(use => use.kind !== "type-only" && use.kind !== "source-linkage")
    .map(use => use.reference));
  const usesEnvironment = (node: Node): boolean => {
    const binding = records.sourceBinding.get(node);
    if (binding !== undefined && (capturedDeclarations.has(binding.sourceDeclaration) ||
      !moduleClass && constructorReferences.has(node))) return true;
    let used = false;
    ast.forEachChild(node, child => { if (!used && child !== undefined) used = usesEnvironment(child); });
    return used;
  };
  const consumers = ast.members(declaration).filter((member): member is Node => member !== undefined && usesEnvironment(member));
  for (const field of staticFields) {
    let selfReference = false;
    const visit = (node: Node): void => {
      if (records.sourceBinding.get(node)?.sourceDeclaration === declaration) selfReference = true;
      ast.forEachChild(node, child => { if (!selfReference && child !== undefined) visit(child); });
    };
    visit(Node_Initializer(ast, field.declaration)!);
    if (selfReference) return { kind: "unresolved", reason: "Self-referencing static initialization requires an exact staged class-evaluation contract." };
  }
  const constructorIdentity = constructorValue && requiresConstructorIdentity(walk, declaration);
  const storage = selectRustClassEnvironmentStorage({ constructorIdentity, staticFields, captures });
  const ownParameters = new Set((walk.context.sourceLifetimes.contractFor(declaration)?.parameters ?? []).map(parameter => parameter.declaration));
  const genericParameterIndexes = Object.freeze(definition.genericParameters.flatMap((parameter, index) => ownParameters.has(parameter.declaration) ? [] : [index]));
  return { kind: "available", environment: Object.freeze({ declaration, carrier: projectTypes.openCarrier(definition), genericParameterIndexes,
    ...storage, constructorValue, constructorIdentity, evaluatedConstructorValue: walk.context.classValues.evaluatesConstructorValue(declaration),
    consumers: Object.freeze(consumers),
    initializationUsesEnvironment: consumers.some(member => ast.kindName(member) === "KindConstructor" ||
      ast.kindName(member) === "KindPropertyDeclaration" && !ast.hasModifierKind(member, "static")),
    instancesUseEnvironment: consumers.some(member => !ast.hasModifierKind(member, "static") &&
      ["KindMethodDeclaration", "KindGetAccessor", "KindSetAccessor"].includes(ast.kindName(member))),
    captures: Object.freeze(captures.map(capture => Object.freeze(capture))),
    staticFields: Object.freeze(staticFields.map(field => Object.freeze(field))),
  }) };
}

function requiresConstructorIdentity(walk: RustFactWalk, declaration: Node): boolean {
  if (walk.context.classValues.hasConstructorView(declaration)) return true;
  const { navigation, ast } = walk.context.source;
  if (navigation.declarationUseSummary(declaration).exported) return true;
  const expressions = ast.is.IsClassExpression(declaration) ? [declaration] : [];
  expressions.push(...navigation.declarationUses(declaration)
    .filter(use => use.kind !== "type-only" && use.kind !== "source-linkage")
    .map(use => use.reference));
  return expressions.some(expression => {
    const flow = navigation.expressionValueFlow(expression);
    return flow.identityCompared || flow.escapes || flow.hasUnclassifiedUse;
  });
}
