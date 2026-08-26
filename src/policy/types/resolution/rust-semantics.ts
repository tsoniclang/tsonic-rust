import type { Node } from "@tsonic/tsts";
import { Node_Type, sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  rustSourceGenericParameterFactKey,
  rustSourceTypeContractFactKey,
} from "../../../source/semantics/facts.js";
import type { RustSourceTypeContractFact } from "../../../source/semantics/model.js";
import {
  rustInferredLifetime,
  rustFunctionPointerTargetType,
  rustBuiltinPathTypeMatches,
  rustReferenceTargetType,
  rustBoundOpenGenericIdentityKeys,
  rustTupleElementCarriers,
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
import {
  compareRustCapturedGenerics,
  rustBoundSemanticKey,
  rustCapturedGenericSemanticKey,
  rustLifetimeSemanticKey,
  rustSemanticIdentitiesEqual,
  rustSemanticIdentityKey,
} from "../../../target-model/semantics/index.js";
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
      const target = rustBuiltinPathTypeMatches(selectedTarget, rustStringTargetId, "rust")
        ? { kind: "str" as const }
        : selectedTarget;
      const occurrence = fact.lifetimeTypeNode === undefined
        ? sourceNodeIdentity(context.ast, node)
        : undefined;
      if (fact.lifetimeTypeNode === undefined && occurrence === undefined) return undefined;
      const lifetime = fact.lifetimeTypeNode === undefined
        ? rustInferredLifetime(`source-reference\0${occurrence!}`)
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
      const traitNodes = rustTraitNodes(fact.traitTypeNode, context);
      if (traitNodes === undefined) return undefined;
      const traits = traitNodes.map((traitNode) => {
        const type = resolveAuthored(traitNode, context, options, resolving);
        return type === undefined
          ? undefined
          : rustTraitClassification(type, context, options);
      });
      const ordinary = traits.filter((entry) => entry?.traitKind === "ordinary");
      const auto = traits.filter((entry) => entry?.traitKind === "auto");
      const autoTraits = auto.map((entry) => entry!.trait).sort((left, right) => {
        const leftKey = rustSemanticIdentityKey(left.identity);
        const rightKey = rustSemanticIdentityKey(right.identity);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
      const autoTraitKeys = autoTraits.map((trait) => rustSemanticIdentityKey(trait.identity));
      const lifetime = fact.lifetimeTypeNode === undefined
        ? { kind: "static" as const }
        : resolveRustLifetime(fact.lifetimeTypeNode, context);
      return traits.some((entry) => entry === undefined) || ordinary.length !== 1 ||
          ordinary[0] === undefined || lifetime === undefined ||
          new Set(autoTraitKeys).size !== autoTraitKeys.length
        ? undefined
        : Object.freeze({
            kind: "trait-object" as const,
            principal: ordinary[0].trait,
            autoTraits: Object.freeze(autoTraits),
            lifetime,
          });
    }
    case "opaque-type": {
      const opaqueContext = sourceOpaqueReturnContext(node, context);
      if (opaqueContext === undefined) return undefined;
      const boundNodes = rustTraitNodes(fact.boundTypeNode, context);
      if (boundNodes === undefined) return undefined;
      const resolvedBounds = boundNodes.map((boundNode): RustBound | undefined => {
        const type = resolveAuthored(boundNode, context, options, resolving);
        const selected = type === undefined
          ? undefined
          : rustTraitClassification(type, context, options);
        return selected === undefined
          ? undefined
          : Object.freeze({
              kind: "trait" as const,
              trait: selected.trait,
              polarity: "required" as const,
            });
      });
      const bounds = resolvedBounds.filter((bound): bound is RustBound => bound !== undefined)
        .sort((left, right) => {
          const leftKey = rustBoundSemanticKey(left);
          const rightKey = rustBoundSemanticKey(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        });
      const boundKeys = bounds.map(rustBoundSemanticKey);
      const authoredCaptures = fact.captureTypeNode === undefined
        ? Object.freeze([])
        : resolveRustCaptureSet(fact.captureTypeNode, context);
      const identity = rustSourceNodeIdentity(node, context, "opaque");
      return resolvedBounds.some((bound) => bound === undefined) ||
          new Set(boundKeys).size !== boundKeys.length || authoredCaptures === undefined || identity === undefined
        ? undefined
        : finalizeSourceOpaqueType({
            node,
            context,
            opaqueContext,
            bounds: Object.freeze(bounds),
            authoredCaptures,
            kind: "opaque" as const,
            identity,
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
  const identity = rustSourceNodeIdentity(referenced, context, "lifetime-parameter");
  if (displayName === undefined || identity === undefined) return undefined;
  return Object.freeze({
    kind: "parameter",
    identity,
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
    const value = context.ast.text(literal);
    const scalars = [...value];
    const codePoint = value.codePointAt(0);
    return scalars.length === 1 && codePoint !== undefined &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
      ? Object.freeze({ kind: "literal", literalKind: "character", value })
      : undefined;
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
  const identity = referenced === undefined
    ? undefined
    : rustSourceNodeIdentity(referenced, context, "const-parameter");
  return parameter?.kind === "const" && referenced !== undefined && displayName !== undefined &&
      identity !== undefined
    ? Object.freeze({
        kind: "parameter",
        identity,
        displayName,
      })
    : undefined;
}

export function rustSourceNodeIdentity(
  node: Node,
  context: RustTargetTypeResolutionContext,
  role: string,
): RustSemanticIdentity | undefined {
  return rustSourceDeclarationIdentity(node, context.ast, role);
}

export function rustSourceDeclarationIdentity(
  node: Node,
  ast: RustTargetTypeResolutionContext["ast"],
  role: string,
): RustSemanticIdentity | undefined {
  const occurrence = sourceNodeIdentity(ast, node);
  const sourceFile = ast.getSourceFile(node);
  return occurrence === undefined || sourceFile === undefined
    ? undefined
    : Object.freeze({
        kind: "project",
        packageId: "source-program",
        sourceFileId: ast.getPath(sourceFile),
        declarationId: `${role}\0${occurrence}`,
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
  const parameters = rustTupleElementCarriers(parametersCarrier);
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
  const occurrence = sourceNodeIdentity(context.ast, fact.parameterTypesNode);
  if (occurrence === undefined) return undefined;
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

function rustTraitClassification(
  type: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): {
  readonly trait: RustTraitRef;
  readonly traitKind: "ordinary" | "auto";
} | undefined {
  const trait = rustTraitReferenceFromType(type);
  if (type.kind !== "path" || trait === undefined) return undefined;
  const relation = options.providerTypes.find((candidate) =>
    candidate.targetCarrier.kind === "path" &&
    rustSemanticIdentitiesEqual(candidate.targetCarrier.identity, type.identity));
  if (relation?.targetDeclarationKind === "trait") {
    return Object.freeze({ trait, traitKind: relation.targetTraitKind });
  }
  const declaration = options.sourceTypes.declarationForCarrier(type);
  return declaration !== undefined &&
      context.ast.kindName(declaration) === "KindInterfaceDeclaration"
    ? Object.freeze({ trait, traitKind: "ordinary" })
    : undefined;
}

function rustTraitNodes(
  node: Node,
  context: RustTargetTypeResolutionContext,
): readonly Node[] | undefined {
  if (!context.ast.is.IsIntersectionTypeNode(node)) return Object.freeze([node]);
  const elements = context.ast.elements(node);
  return elements.some((entry) => entry === undefined)
    ? undefined
    : Object.freeze(elements as readonly Node[]);
}

function resolveRustCaptureSet(
  node: Node,
  context: RustTargetTypeResolutionContext,
): readonly RustCapturedGeneric[] | undefined {
  const contract = context.facts.resolve(node, rustSourceTypeContractFactKey) ??
    context.facts.get(node, rustSourceTypeContractFactKey);
  if (contract?.kind !== "capture-set") return undefined;
  const rawElements = context.ast.elements(contract.tupleTypeNode);
  if (rawElements.some((entry) => entry === undefined)) return undefined;
  const elements = rawElements as readonly Node[];
  const resolved = elements.map((element): RustCapturedGeneric | undefined => {
    const lifetime = resolveRustLifetime(element, context);
    if (lifetime !== undefined) {
      return lifetime.kind === "parameter"
        ? Object.freeze({ kind: "lifetime", value: lifetime })
        : undefined;
    }
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
    if (displayName === undefined || identity === undefined) return undefined;
    return fact.kind === "type"
      ? Object.freeze({ kind: "type", identity, displayName })
      : fact.kind === "const"
        ? Object.freeze({ kind: "const", identity, displayName })
        : undefined;
  });
  if (resolved.some((capture) => capture === undefined)) return undefined;
  const captures = (resolved as RustCapturedGeneric[]).sort(compareRustCapturedGenerics);
  const keys = captures.map(rustCapturedGenericSemanticKey);
  return new Set(keys).size === keys.length
    ? Object.freeze(captures)
    : undefined;
}

interface RustSourceOpaqueReturnContext {
  readonly callable: Node;
  readonly genericContracts: readonly import("../../types/source-generics.js").RustSourceGenericContract[];
  readonly implicitSelfOwner?: Node;
}

function sourceOpaqueReturnContext(
  node: Node,
  context: RustTargetTypeResolutionContext,
): RustSourceOpaqueReturnContext | undefined {
  const genericContracts: import("../../types/source-generics.js").RustSourceGenericContract[] = [];
  const seenContracts = new Set<Node>();
  let current: Node | undefined = node;
  let callable: Node | undefined;
  let implicitSelfOwner: Node | undefined;
  while (current !== undefined) {
    const contract = context.sourceGenerics.contractFor(current);
    if (contract !== undefined && !seenContracts.has(contract.declaration)) {
      seenContracts.add(contract.declaration);
      genericContracts.push(contract);
    }
    const kind = context.ast.kindName(current);
    if (callable === undefined && rustOpaqueCallableKind(kind) && Node_Type(context.ast, current) === node) {
      callable = current;
    }
    if (kind === "KindInterfaceDeclaration") implicitSelfOwner = current;
    current = context.ast.parent(current);
  }
  return callable === undefined
    ? undefined
    : Object.freeze({
        callable,
        genericContracts: Object.freeze(genericContracts),
        ...(context.ast.kindName(callable) === "KindMethodSignature" && implicitSelfOwner !== undefined
          ? { implicitSelfOwner }
          : {}),
      });
}

function rustOpaqueCallableKind(kind: string | undefined): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" || kind === "KindGetAccessor";
}

function finalizeSourceOpaqueType(options: {
  readonly node: Node;
  readonly context: RustTargetTypeResolutionContext;
  readonly opaqueContext: RustSourceOpaqueReturnContext;
  readonly bounds: readonly RustBound[];
  readonly authoredCaptures: readonly RustCapturedGeneric[];
  readonly kind: "opaque";
  readonly identity: RustSemanticIdentity;
}): TargetTypeRef | undefined {
  const referencedKeys = new Set(options.bounds.flatMap(rustBoundOpenGenericIdentityKeys));
  const allowedCaptures: RustCapturedGeneric[] = [];
  const requiredCaptureKeys = new Set<string>();
  for (const contract of options.opaqueContext.genericContracts) {
    for (const parameter of contract.parameters) {
      const capture = sourceGenericParameterCapture(parameter.parameter);
      if (capture === undefined) return undefined;
      allowedCaptures.push(capture);
      if (capture.kind !== "lifetime" || referencedKeys.has(rustLifetimeSemanticKey(capture.value))) {
        requiredCaptureKeys.add(rustCapturedGenericSemanticKey(capture));
      }
    }
  }
  let implicitSelfCapture: RustCapturedGeneric | undefined;
  if (options.opaqueContext.implicitSelfOwner !== undefined) {
    const identity = rustSourceNodeIdentity(
      options.opaqueContext.implicitSelfOwner,
      options.context,
      "implicit-self-parameter",
    );
    if (identity === undefined) return undefined;
    implicitSelfCapture = Object.freeze({
      kind: "type" as const,
      identity,
      displayName: "Self",
    });
    allowedCaptures.push(implicitSelfCapture);
    requiredCaptureKeys.add(rustCapturedGenericSemanticKey(implicitSelfCapture));
  }
  const allowedCaptureKeys = new Set(allowedCaptures.map(rustCapturedGenericSemanticKey));
  const authoredCaptureKeys = new Set(options.authoredCaptures.map(rustCapturedGenericSemanticKey));
  const implicitSelfCaptureKey = implicitSelfCapture === undefined
    ? undefined
    : rustCapturedGenericSemanticKey(implicitSelfCapture);
  if (options.authoredCaptures.some((capture) => !allowedCaptureKeys.has(
    rustCapturedGenericSemanticKey(capture),
  )) || [...requiredCaptureKeys].some((key) =>
    key !== implicitSelfCaptureKey && !authoredCaptureKeys.has(key))) {
    return undefined;
  }
  const captures = [...options.authoredCaptures];
  if (implicitSelfCapture !== undefined &&
    !captures.some((candidate) => rustCapturedGenericSemanticKey(candidate) ===
      implicitSelfCaptureKey)) {
    captures.push(implicitSelfCapture);
  }
  captures.sort(compareRustCapturedGenerics);
  return Object.freeze({
    kind: options.kind,
    identity: options.identity,
    bounds: options.bounds,
    captures: Object.freeze(captures),
  });
}

function sourceGenericParameterCapture(
  parameter: RustGenericParameter,
): RustCapturedGeneric | undefined {
  switch (parameter.kind) {
    case "lifetime":
      return parameter.identity.kind === "parameter"
        ? Object.freeze({ kind: "lifetime", value: parameter.identity })
        : undefined;
    case "type":
      return Object.freeze({
        kind: "type",
        identity: parameter.identity,
        displayName: parameter.displayName,
      });
    case "const":
      return Object.freeze({
        kind: "const",
        identity: parameter.identity,
        displayName: parameter.displayName,
      });
  }
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
