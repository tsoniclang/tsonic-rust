import { asNode } from "../../evidence/selected-source.js";
import { denseDefined } from "./project.js";
import { resolveRustCallableEvidence } from "./source.js";
import { resolveRustTargetType } from "./target.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../target-model/types/index.js";
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
    return undefined;
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
  const name = context.ast.text(context.ast.name(declaration));
  return name.length === 0 ? undefined : { kind: "type-parameter", name };
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
  const distinctValueCarriers = (valueCarriers as readonly TargetTypeRef[]).filter(
    (carrier, index, all) => all.findIndex((candidate) =>
      rustTargetTypeRefEquals(candidate, carrier)) === index,
  );
  if (distinctValueCarriers.length === 1) {
    if (nullishMembers.length === 0) {
      return distinctValueCarriers[0];
    }
    return nullishMembers.length === 1
      ? rustOptionTargetType(distinctValueCarriers[0]!)
      : undefined;
  }
  if (members.length > 0 && members.every((member) => context.currentSemantics.types.isStringLike(member))) {
    return rustStringTargetType();
  }
  if (members.length > 0 && members.every((member) => context.currentSemantics.types.isNumberLike(member))) {
    return rustSourcePrimitiveTargetType("float64");
  }
  if (members.length > 0 && members.every((member) => context.currentSemantics.types.isBooleanLike(member))) {
    return rustSourcePrimitiveTargetType("bool");
  }
  const memberCarriers = members.map((member) =>
    resolveRustTargetType(member, context, options, resolving));
  if (memberCarriers.length > 1 && memberCarriers.every((carrier) => carrier !== undefined)) {
    return options.resolveProjectUnionCarrier(
      memberCarriers as readonly TargetTypeRef[],
    );
  }
  return undefined;
}
