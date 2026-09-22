import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceTypeCarrierValue, substituteRustTargetTypeParameters } from "../../target-model/types/index.js";
import { inferRustTargetTypeParameterBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustImplicitInterfaceContract } from "../../target-model/types/project-interfaces.js";

export function collectRustImplicitInterfaceContracts(walk: RustFactWalk): readonly RustImplicitInterfaceContract[] {
  const contracts: RustImplicitInterfaceContract[] = [];
  const visited = new WeakMap<Type, WeakSet<Type>>();
  const { ast } = walk.context;
  const collect = (source: Type, target: Type, subject: Node, semantics: SourceFileSemantics): void => {
    const targetsSeen = visited.get(source) ?? new WeakSet<Type>();
    if (targetsSeen.has(target)) return;
    targetsSeen.add(target);
    visited.set(source, targetsSeen);
    const sourceConstructs = semantics.types.constructSignatures(source);
    const targetConstructs = semantics.types.constructSignatures(target);
    if (sourceConstructs.length === 1 && targetConstructs.length === 1) {
      const sourceResult = semantics.types.returnType(sourceConstructs[0]!);
      const targetResult = semantics.types.returnType(targetConstructs[0]!);
      if (sourceResult !== undefined && targetResult !== undefined) collect(sourceResult, targetResult, subject, semantics);
      return;
    }
    if (sourceConstructs.length !== 0 || targetConstructs.length !== 0) return;
    const sourceSymbol = semantics.declarations.typeSymbol(source);
    const targetSymbol = semantics.declarations.typeSymbol(target);
    const sources = sourceSymbol === undefined ? [] : semantics.declarations.symbolDeclarations(sourceSymbol)
      .filter(declaration => ast.is.IsClassDeclaration(declaration) || ast.is.IsClassExpression(declaration));
    const targets = targetSymbol === undefined ? [] : semantics.declarations.symbolDeclarations(targetSymbol)
      .filter(declaration => ast.is.IsInterfaceDeclaration(declaration));
    if (sources.length !== 1 || targets.length !== 1) return;
    const sourceDeclaration = sources[0]!;
    const targetDeclaration = targets[0]!;
    const sourceTemplate = semantics.declarations.declaredType(sourceDeclaration);
    const targetTemplate = semantics.declarations.declaredType(targetDeclaration);
    if (sourceTemplate === undefined || targetTemplate === undefined) return;
    const pairs = semantics.types.structuralMembers(sourceTemplate, targetTemplate);
    if (pairs.kind !== "available" || pairs.destination.calls.length !== 0 || pairs.destination.constructs.length !== 0 ||
      pairs.destination.indexes.length !== 0 || pairs.members.some(pair => pair.kind !== "present")) return;
    const context = rustResolutionContext(walk, subject);
    const resolve = (type: Type) => resolveRustTargetTypeRef(type, context, walk.operationOptions);
    const openSource = resolve(sourceTemplate);
    const selectedSource = resolve(source);
    const openTarget = resolve(targetTemplate);
    const selectedTarget = resolve(target);
    const sourceValue = rustSourceTypeCarrierValue(openSource);
    const targetValue = rustSourceTypeCarrierValue(openTarget);
    if (openSource === undefined || selectedSource === undefined || openTarget === undefined || selectedTarget === undefined ||
      sourceValue === undefined || targetValue === undefined) return;
    const names = (value: NonNullable<typeof sourceValue>) => new Set(value.genericArguments.flatMap(argument =>
      argument.kind === "type" && argument.type.kind === "type-parameter" ? [argument.type.name] : []));
    const targetNames = names(targetValue);
    const substitutions = new Map<string, TargetTypeRef>();
    const members: RustImplicitInterfaceContract["members"][number][] = [];
    for (const pair of pairs.members) {
      if (pair.kind !== "present") return;
      const declaration = pair.source.getters[0] ?? (pair.source.declarations.length === 1 ? pair.source.declarations[0] : undefined);
      const implementation = declaration === undefined ? undefined : walk.context.source.navigation.sourceReferenceFor(ast.name(declaration));
      if (implementation?.symbol === undefined || implementation.declaration !== declaration || !implementation.project) return;
      for (const member of pair.destination.declarations) members.push(Object.freeze({ declaration: member,
        implementation: Object.freeze({ symbol: implementation.symbol, declaration: implementation.declaration, sourceFile: implementation.sourceFile }) }));
      const provided = resolve(pair.source.property.type);
      const required = resolve(pair.destination.property.type);
      if (provided === undefined || required === undefined) return;
      const inferred = inferRustTargetTypeParameterBindings(required, provided, targetNames);
      if (inferred === undefined) return;
      for (const [name, type] of inferred) {
        const previous = substitutions.get(name);
        if (previous !== undefined && !rustTargetTypeRefEquals(previous, type)) return;
        substitutions.set(name, type);
      }
    }
    if ([...targetNames].some(name => !substitutions.has(name))) return;
    const carrier = substituteRustTargetTypeParameters(openTarget, substitutions);
    const instantiated = inferRustTargetTypeParameterBindings(openSource, selectedSource, names(sourceValue));
    if (instantiated === undefined || !rustTargetTypeRefEquals(substituteRustTargetTypeParameters(carrier, instantiated), selectedTarget)) return;
    if (!contracts.some(contract => contract.source === sourceDeclaration && contract.target === targetDeclaration &&
      rustTargetTypeRefEquals(contract.carrier, carrier))) contracts.push(Object.freeze({ source: sourceDeclaration, target: targetDeclaration,
        subject, carrier, members: Object.freeze(members) }));
  };
  const visit = (node: Node): void => {
    if (["KindIdentifier", "KindNewExpression", "KindCallExpression", "KindClassExpression", "KindPropertyAccessExpression",
      "KindElementAccessExpression", "KindThisKeyword", "KindConditionalExpression"].includes(ast.kindName(node))) {
      const semantics = walk.context.semanticsFor(node);
      const selected = semantics.types.contextualValueSelection(node);
      const source = selected.kind === "selected" ? semantics.types.expressionType(node) : undefined;
      if (source !== undefined && selected.kind === "selected") collect(source, selected.type, node, semantics);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of walk.context.sourceFiles) visit(sourceFile);
  return Object.freeze(contracts);
}
