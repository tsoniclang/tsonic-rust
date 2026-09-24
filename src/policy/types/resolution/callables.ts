import { resolveRustSourceUnionCarrier } from "./source-unions.js";
import { asNode } from "../../evidence/selected-source.js";
import { denseDefined } from "./project.js";
import { resolveRustCallableEvidence } from "./source-evidence.js";
import { resolveRustTargetType } from "./target.js";
import { resolveRustInferredObjectUnion } from "./inferred-unions.js";
import { rustAbsenceTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../target-model/types/index.js";
import { isRustBigIntCarrier, rustJsNumericTargetType, rustJsStringNumberTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { sourceNodesEqual } from "@tsonic/target-api/source";
import { sourcePrimitiveFactKey } from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function resolveCallableType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const callable = context.currentSemantics.types.callable(type);
  if (callable === undefined) {
    return undefined;
  }
  const declaration = callable.result.declaration;
  if (declaration !== undefined && context.ast.typeParameters(declaration).length > 0) {
    const contract = context.sourceLifetimes.contractFor(declaration);
    if (contract === undefined || contract.parameters.some(parameter => parameter.kind !== "type") &&
      (contract.lifetimeBinder === undefined || contract.parameters.some(parameter => parameter.kind !== "lifetime"))) {
      return undefined;
    }
  }
  return resolveRustCallableEvidence(
    callable,
    context,
    options,
    resolving,
  );
}

export function resolveSourceTypeParameter(
  symbol: Symbol | undefined,
  referencedDeclaration: Node | undefined,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  const symbolDeclaration = symbol === undefined
    ? undefined
    : context.currentSemantics.declarations.primarySymbolDeclaration(symbol);
  if (referencedDeclaration !== undefined && symbolDeclaration !== undefined &&
    !sourceNodesEqual(context.ast, referencedDeclaration, symbolDeclaration)) {
    return undefined;
  }
  const declaration = referencedDeclaration ?? symbolDeclaration;
  if (declaration === undefined || context.ast.kindName(declaration) !== "KindTypeParameter") {
    return undefined;
  }
  const substitution = context.sourceTypeParameterSubstitutions?.get(declaration);
  if (substitution !== undefined) return substitution.carrier;
  const name = context.ast.text(context.ast.name(declaration));
  return name.length === 0 ? undefined : { kind: "type-parameter", name };
}

export function resolveBoundSourceTypeParameter(
  node: Node,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  if ((context.sourceTypeParameterSubstitutions?.size ?? 0) === 0) return undefined;
  const semantics = context.semanticsFor(node);
  const type = semantics.types.authoredType(node);
  const symbol = type === undefined ? undefined : semantics.declarations.typeSymbol(type);
  const declaration = symbol === undefined ? undefined : semantics.declarations.primarySymbolDeclaration(symbol);
  return declaration === undefined ? undefined : context.sourceTypeParameterSubstitutions?.get(declaration)?.carrier;
}

export function resolveSourcePrimitive(
  subject: ExtensionFactSubject,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  if (node !== undefined) {
    const direct = context.facts.get(node, sourcePrimitiveFactKey);
    return direct === undefined ? undefined : rustSourcePrimitiveTargetType(direct.kind);
  }
  const type = subject as Type;
  const symbol = context.currentSemantics.declarations.typeAliasSymbol(type) ??
    context.currentSemantics.declarations.typeSymbol(type);
  if (symbol === undefined) {
    return undefined;
  }
  const symbolFact = context.facts.get(symbol, sourcePrimitiveFactKey);
  if (symbolFact !== undefined) {
    return rustSourcePrimitiveTargetType(symbolFact.kind);
  }
  const declarations = denseDefined(
    context.currentSemantics.declarations.symbolDeclarations(symbol),
  );
  if (declarations === undefined) {
    return undefined;
  }
  for (const declaration of declarations) {
    const declarationFact = context.facts.get(declaration, sourcePrimitiveFactKey);
    if (declarationFact !== undefined) {
      return rustSourcePrimitiveTargetType(declarationFact.kind);
    }
  }
  return undefined;
}

export function resolveUnion(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const members = denseDefined(
    context.currentSemantics.types.unionOrIntersectionTypes(type),
  );
  if (members === undefined) {
    return undefined;
  }
  const valueMembers = members.filter((member) => !context.currentSemantics.types.isNullish(member));
  const nullishMembers = members.filter((member) => context.currentSemantics.types.isNullish(member));
  const valueCarriers = valueMembers.map((member) =>
    resolveRustTargetType(member, context, options, resolving));
  if (valueCarriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  return resolveRustSourceUnionCarrier([
    ...(valueCarriers as readonly TargetTypeRef[]),
    ...nullishMembers.map(() => rustAbsenceTargetType()),
  ], (distinct) => {
    if (options.jsEnabled && distinct.length === 2 &&
      distinct.some(carrier => rustTargetTypeRefEquals(carrier, rustStringTargetType())) &&
      distinct.some(carrier => rustTargetTypeRefEquals(carrier, rustSourcePrimitiveTargetType("float64")))) {
      return rustJsStringNumberTargetType();
    }
    if (options.jsEnabled && distinct.length === 2 && distinct.some(isRustBigIntCarrier) &&
      distinct.some(carrier => rustTargetTypeRefEquals(carrier, rustSourcePrimitiveTargetType("float64")))) {
      return rustJsNumericTargetType();
    }
    const common = options.resolveProjectUnionCarrier(distinct);
    return common !== undefined && distinct.some(carrier => rustTargetTypeRefEquals(carrier, common))
      ? common
      : resolveRustInferredObjectUnion(type, valueMembers, valueCarriers as readonly TargetTypeRef[], context, options) ?? common;
  });
}
