import type { Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  rustSourceGenericParameterFactKey,
  rustSourceTypeContractFactKey,
} from "../../../source/semantics/facts.js";
import type { RustSourceTypeContractFact } from "../../../source/semantics/model.js";
import {
  rustInferredLifetime,
  rustFunctionPointerTargetType,
  rustPathTypeMatches,
  rustReferenceTargetType,
} from "../../../target-model/types/index.js";
import { rustStringTargetId } from "../../../target-model/types/carriers/source-types.js";
import type {
  RustBound,
  RustCapturedGeneric,
  RustConstExpr,
  RustGenericArgument,
  RustGenericParameter,
  RustLifetimeRef,
  RustSemanticIdentity,
  RustTraitRef,
} from "../../../target-model/semantics/index.js";
import { rustSemanticIdentitiesEqual } from "../../../target-model/semantics/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./model.js";
import { selectedSourceIntegerLiteralValue } from "../selected-numeric-literal.js";
import { resolveRustFunctionPointerLifetimeElision } from "../../ownership/lifetime-elision.js";
import {
  rustScreamingSnakeIdentifier,
  rustSnakeCaseIdentifier,
} from "../../../target-model/names/identifiers.js";

export function resolveRustSemanticSourceType(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  resolveAuthored: (
    node: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
    resolving: Set<object>,
  ) => TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const fact = context.facts.resolve(node, rustSourceTypeContractFactKey) ??
    context.facts.get(node, rustSourceTypeContractFactKey);
  if (fact === undefined) return undefined;
  switch (fact.kind) {
    case "owned":
      return resolveAuthored(fact.targetTypeNode, context, options, resolving);
    case "shared-reference":
    case "mutable-reference": {
      const selectedTarget = resolveAuthored(fact.targetTypeNode, context, options, resolving);
      if (selectedTarget === undefined) return undefined;
      const target = rustPathTypeMatches(selectedTarget, rustStringTargetId)
        ? { kind: "str" as const }
        : selectedTarget;
      const lifetime = fact.lifetimeTypeNode === undefined
        ? rustInferredLifetime(
            `source-reference\0${sourceNodeIdentity(context.ast, node) ?? [
              context.ast.getPath(context.ast.getSourceFile(node)),
              context.ast.pos(node),
              context.ast.end(node),
            ].join(":")}`,
          )
        : resolveRustLifetime(fact.lifetimeTypeNode, context);
      return lifetime === undefined
        ? undefined
        : rustReferenceTargetType(
            target,
            fact.kind === "mutable-reference",
            lifetime,
          );
    }
    case "rust-char":
      return Object.freeze({ kind: "primitive", name: "char" });
    case "trait-object": {
      const traits = rustTraitNodes(fact.traitTypeNode, context).map((traitNode) => {
        const type = resolveAuthored(traitNode, context, options, resolving);
        const trait = type === undefined ? undefined : rustTraitReferenceFromType(type);
        const relation = type?.kind === "path"
          ? options.providerTypes.find((candidate) =>
              candidate.targetCarrier.kind === "path" &&
              rustSemanticIdentitiesEqual(candidate.targetCarrier.identity, type.identity))
          : undefined;
        return relation?.targetDeclarationKind === "trait" && trait !== undefined
          ? { trait, traitKind: relation.targetTraitKind }
          : undefined;
      });
      const ordinary = traits.filter((entry) => entry?.traitKind === "ordinary");
      const auto = traits.filter((entry) => entry?.traitKind === "auto");
      const lifetime = fact.lifetimeTypeNode === undefined
        ? { kind: "static" as const }
        : resolveRustLifetime(fact.lifetimeTypeNode, context);
      return traits.some((entry) => entry === undefined) || ordinary.length !== 1 ||
          ordinary[0] === undefined || lifetime === undefined
        ? undefined
        : Object.freeze({
            kind: "trait-object" as const,
            principal: ordinary[0].trait,
            autoTraits: Object.freeze(auto.map((entry) => entry!.trait)),
            lifetime,
          });
    }
    case "opaque-type": {
      const bounds = rustTraitNodes(fact.boundTypeNode, context).map((boundNode): RustBound | undefined => {
        const type = resolveAuthored(boundNode, context, options, resolving);
        const trait = type === undefined ? undefined : rustTraitReferenceFromType(type);
        return trait === undefined
          ? undefined
          : Object.freeze({ kind: "trait" as const, trait, polarity: "required" as const });
      });
      const captures = fact.captureTypeNode === undefined
        ? Object.freeze([])
        : resolveRustCaptureSet(fact.captureTypeNode, context);
      return bounds.some((bound) => bound === undefined) || captures === undefined
        ? undefined
        : Object.freeze({
            kind: "opaque" as const,
            identity: rustSourceNodeIdentity(node, context, "opaque"),
            bounds: Object.freeze(bounds as RustBound[]),
            captures,
          });
    }
    case "function-pointer":
      return resolveFunctionPointer(fact, context, options, resolving, resolveAuthored);
    case "lifetime-kind":
    case "static-lifetime":
    case "outlives":
    case "valid-for":
    case "const-parameter":
    case "capture-set":
    case "maybe-sized":
      return undefined;
  }
}

export function resolveRustLifetime(
  node: Node,
  context: RustTargetTypeResolutionContext,
): RustLifetimeRef | undefined {
  const contract = context.facts.resolve(node, rustSourceTypeContractFactKey) ??
    context.facts.get(node, rustSourceTypeContractFactKey);
  if (contract?.kind === "static-lifetime") return Object.freeze({ kind: "static" });
  const referenced = rustReferencedTypeParameter(node, context);
  const parameter = referenced === undefined
    ? undefined
    : context.facts.resolve(referenced, rustSourceGenericParameterFactKey) ??
      context.facts.get(referenced, rustSourceGenericParameterFactKey);
  if (parameter?.kind !== "lifetime") return undefined;
  if (referenced === undefined) return undefined;
  const sourceName = sourceNodeDisplayName(referenced, context);
  const displayName = sourceName === undefined
    ? undefined
    : rustSnakeCaseIdentifier(sourceName);
  if (displayName === undefined) return undefined;
  return Object.freeze({
    kind: "parameter",
    identity: rustSourceNodeIdentity(referenced, context, "lifetime-parameter"),
    displayName,
  });
}

export function resolveRustSourceGenericArgument(
  node: Node,
  parameter: RustGenericArgument | RustGenericParameter,
  context: RustTargetTypeResolutionContext,
  resolveType: (node: Node) => TargetTypeRef | undefined,
): RustGenericArgument | undefined {
  switch (parameter.kind) {
    case "lifetime": {
      const value = resolveRustLifetime(node, context);
      return value === undefined ? undefined : Object.freeze({ kind: "lifetime", value });
    }
    case "type": {
      const value = resolveType(node);
      return value === undefined ? undefined : Object.freeze({ kind: "type", value });
    }
    case "const": {
      const value = resolveRustConstExpression(node, context);
      return value === undefined ? undefined : Object.freeze({ kind: "const", value });
    }
  }
}

export function resolveRustConstExpression(
  node: Node,
  context: RustTargetTypeResolutionContext,
): RustConstExpr | undefined {
  const literal = context.ast.is.IsLiteralTypeNode(node)
    ? context.ast.as.AsLiteralTypeNode(node)?.Literal
    : node;
  if (literal === undefined) return undefined;
  const integer = selectedSourceIntegerLiteralValue(literal, context.ast);
  if (integer !== undefined) return Object.freeze({ kind: "literal", literalKind: "integer", value: integer });
  if (context.ast.is.IsStringLiteral(literal)) {
    return Object.freeze({ kind: "literal", literalKind: "character", value: context.ast.text(literal) });
  }
  const kind = context.ast.kindName(literal);
  if (kind === "KindTrueKeyword" || kind === "KindFalseKeyword") {
    return Object.freeze({ kind: "literal", literalKind: "boolean", value: kind === "KindTrueKeyword" });
  }
  const referenced = rustReferencedTypeParameter(node, context);
  const parameter = referenced === undefined
    ? undefined
    : context.facts.resolve(referenced, rustSourceGenericParameterFactKey) ??
      context.facts.get(referenced, rustSourceGenericParameterFactKey);
  const sourceName = referenced === undefined
    ? undefined
    : sourceNodeDisplayName(referenced, context);
  const displayName = sourceName === undefined
    ? undefined
    : rustScreamingSnakeIdentifier(sourceName);
  return parameter?.kind === "const" && referenced !== undefined && displayName !== undefined
    ? Object.freeze({
        kind: "parameter",
        identity: rustSourceNodeIdentity(referenced, context, "const-parameter"),
        displayName,
      })
    : undefined;
}

export function rustSourceNodeIdentity(
  node: Node,
  context: RustTargetTypeResolutionContext,
  role: string,
): RustSemanticIdentity {
  return rustSourceDeclarationIdentity(node, context.ast, role);
}

export function rustSourceDeclarationIdentity(
  node: Node,
  ast: RustTargetTypeResolutionContext["ast"],
  role: string,
): RustSemanticIdentity {
  const sourceFile = ast.getSourceFile(node);
  return Object.freeze({
    kind: "project",
    packageId: "source-program",
    sourceFileId: ast.getPath(sourceFile),
    declarationId: `${role}:${ast.pos(node)}:${ast.end(node)}`,
  });
}

function resolveFunctionPointer(
  fact: Extract<RustSourceTypeContractFact, { readonly kind: "function-pointer" }>,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  resolveAuthored: (
    node: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
    resolving: Set<object>,
  ) => TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const parametersCarrier = resolveAuthored(
    fact.parameterTypesNode,
    context,
    options,
    resolving,
  );
  const result = resolveAuthored(fact.resultTypeNode, context, options, resolving);
  const parameters = parametersCarrier?.kind === "tuple"
    ? parametersCarrier.elements
    : undefined;
  const abi = fact.abiTypeNode === undefined
    ? "Rust" as const
    : sourceStringLiteral(fact.abiTypeNode, context);
  const safety = fact.safetyTypeNode === undefined
    ? "safe" as const
    : sourceBooleanLiteral(fact.safetyTypeNode, context) === true
      ? "unsafe" as const
      : sourceBooleanLiteral(fact.safetyTypeNode, context) === false
        ? "safe" as const
        : undefined;
  const variadic = fact.variadicTypeNode === undefined
    ? false
    : sourceBooleanLiteral(fact.variadicTypeNode, context);
  if (parameters === undefined || result === undefined || abi === undefined ||
      !isRustAbi(abi) || safety === undefined || variadic === undefined) {
    return undefined;
  }
  const occurrence = sourceNodeIdentity(context.ast, fact.parameterTypesNode) ?? [
    context.ast.getPath(context.ast.getSourceFile(fact.parameterTypesNode)),
    context.ast.pos(fact.parameterTypesNode),
    context.ast.end(fact.parameterTypesNode),
  ].join(":");
  const elision = resolveRustFunctionPointerLifetimeElision({
    binderId: `source-function-pointer\0${occurrence}`,
    parameters,
    result,
  });
  return elision.kind === "rejected"
    ? undefined
    : rustFunctionPointerTargetType({
        ...(elision.binder === undefined ? {} : { binder: elision.binder }),
        parameters: elision.parameters,
        result: elision.result,
        abi,
        safety,
        variadic,
      });
}

function rustTraitReferenceFromType(type: TargetTypeRef): RustTraitRef | undefined {
  if (type.kind !== "path") return undefined;
  return Object.freeze({
    identity: type.identity,
    displayPath: type.displayPath,
    arguments: type.arguments,
    associatedConstraints: Object.freeze([]),
  });
}

function rustTraitNodes(
  node: Node,
  context: RustTargetTypeResolutionContext,
): readonly Node[] {
  return context.ast.is.IsIntersectionTypeNode(node)
    ? context.ast.elements(node).filter((entry): entry is Node => entry !== undefined)
    : Object.freeze([node]);
}

function resolveRustCaptureSet(
  node: Node,
  context: RustTargetTypeResolutionContext,
): readonly RustCapturedGeneric[] | undefined {
  const contract = context.facts.resolve(node, rustSourceTypeContractFactKey) ??
    context.facts.get(node, rustSourceTypeContractFactKey);
  if (contract?.kind !== "capture-set") return undefined;
  const elements = context.ast.elements(contract.tupleTypeNode).filter(
    (entry): entry is Node => entry !== undefined,
  );
  const captures = elements.map((element): RustCapturedGeneric | undefined => {
    const lifetime = resolveRustLifetime(element, context);
    if (lifetime !== undefined) return Object.freeze({ kind: "lifetime", value: lifetime });
    const declaration = rustReferencedTypeParameter(element, context);
    const fact = declaration === undefined
      ? undefined
      : context.facts.resolve(declaration, rustSourceGenericParameterFactKey) ??
        context.facts.get(declaration, rustSourceGenericParameterFactKey);
    if (declaration === undefined || fact === undefined) return undefined;
    const identity = rustSourceNodeIdentity(declaration, context, `${fact.kind}-parameter`);
    const sourceName = sourceNodeDisplayName(declaration, context);
    const displayName = sourceName === undefined
      ? undefined
      : fact.kind === "type"
        ? context.names.nameForDeclaration(declaration)
        : rustScreamingSnakeIdentifier(sourceName);
    if (displayName === undefined) return undefined;
    return fact.kind === "type"
      ? Object.freeze({ kind: "type", identity, displayName })
      : fact.kind === "const"
        ? Object.freeze({ kind: "const", identity, displayName })
        : undefined;
  });
  return captures.some((capture) => capture === undefined)
    ? undefined
    : Object.freeze(captures as RustCapturedGeneric[]);
}

function rustReferencedTypeParameter(
  node: Node,
  context: RustTargetTypeResolutionContext,
): Node | undefined {
  return context.ast.is.IsTypeParameterDeclaration(node)
    ? node
    : context.source.navigation.sourceReferenceFor(node)?.declaration;
}

function sourceNodeDisplayName(
  node: Node,
  context: RustTargetTypeResolutionContext,
): string | undefined {
  const name = context.ast.name(node);
  const text = name === undefined ? undefined : context.ast.text(name);
  return text === undefined || text.length === 0 ? undefined : text;
}

function sourceStringLiteral(
  node: Node,
  context: RustTargetTypeResolutionContext,
): string | undefined {
  const literal = context.ast.is.IsLiteralTypeNode(node)
    ? context.ast.as.AsLiteralTypeNode(node)?.Literal
    : node;
  if (literal === undefined || !context.ast.is.IsStringLiteral(literal)) return undefined;
  return context.ast.text(literal);
}

function sourceBooleanLiteral(
  node: Node,
  context: RustTargetTypeResolutionContext,
): boolean | undefined {
  const literal = context.ast.is.IsLiteralTypeNode(node)
    ? context.ast.as.AsLiteralTypeNode(node)?.Literal
    : node;
  return literal === undefined
    ? undefined
    : context.ast.kindName(literal) === "KindTrueKeyword"
      ? true
      : context.ast.kindName(literal) === "KindFalseKeyword"
        ? false
        : undefined;
}

function isRustAbi(value: string): value is import("../../../target-model/semantics/index.js").RustAbi {
  return rustAbiNames.has(value);
}

const rustAbiNames = new Set<string>([
  "Rust", "C", "C-unwind", "system", "system-unwind", "cdecl", "stdcall",
  "fastcall", "vectorcall", "thiscall", "aapcs", "win64", "sysv64", "efiapi",
]);
