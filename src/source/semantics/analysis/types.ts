import type { Node, SourceAnalysisContext } from "@tsonic/tsts";
import {
  rustSourceGenericParameterFactKey,
  rustSourceTypeContractFactKey,
} from "../facts.js";
import {
  rustSourceTypeExportIds,
  rustSourceVirtualModulesProviderId,
  rustTypesModule,
} from "../identity.js";
import type {
  RustSourceGenericParameterFact,
  RustSourceTypeContractFact,
} from "../model.js";
import {
  appendRustSourceDiagnostic,
  forEachRustSourceFile,
  readRustSourceFact,
  selectedRustProviderTypeDeclaration,
  visitRustSourcePostOrder,
} from "./context.js";
import type { RustSourceFileAnalysisContext } from "./context.js";

export function analyzeRustSourceTypes(context: SourceAnalysisContext): void {
  forEachRustSourceFile(context, (sourceContext): void => {
    visitRustSourcePostOrder(sourceContext.sourceFile, sourceContext, (node): void => {
      if (sourceContext.ast.is.IsTypeReferenceNode(node)) {
        analyzeTypeReference(node, sourceContext);
      }
      if (sourceContext.ast.is.IsTypeParameterDeclaration(node)) {
        analyzeTypeParameter(node, sourceContext);
      }
    });
  });
}

function analyzeTypeReference(
  node: Node,
  context: RustSourceFileAnalysisContext,
): void {
  const selected = selectedRustProviderTypeDeclaration(node, context);
  if (selected?.providerId !== rustSourceVirtualModulesProviderId ||
    selected.providerModuleId !== rustTypesModule ||
    selected.exportId === undefined ||
    !rustSourceTypeContractExportIds.has(selected.exportId)) {
    return;
  }
  const rawArguments = context.ast.typeArguments(node);
  if (rawArguments.some((argument) => argument === undefined)) {
    appendRustSourceDiagnostic(
      context,
      node,
      "RUST_SOURCE_TYPE_ARGUMENT_EVIDENCE_INVALID",
      9300101,
      "Rust lifetime type arguments contain an undefined syntax slot.",
    );
    return;
  }
  const fact = typeContractFor(selected.exportId, rawArguments as readonly Node[]);
  if (fact === undefined) {
    appendRustSourceDiagnostic(
      context,
      node,
      "RUST_SOURCE_TYPE_ARGUMENT_EVIDENCE_INVALID",
      9300101,
      `Rust lifetime type '${selected.exportId}' has an invalid authored argument shape.`,
    );
    return;
  }
  writeTypeContract(node, fact, context);
  const typeName = context.ast.as.AsTypeReferenceNode(node)?.TypeName;
  if (typeName !== undefined) writeTypeContract(typeName, fact, context);
}

function typeContractFor(
  exportId: string,
  args: readonly Node[],
): RustSourceTypeContractFact | undefined {
  switch (exportId) {
    case rustSourceTypeExportIds.life:
      return args.length === 0 ? { kind: "lifetime-kind" } : undefined;
    case rustSourceTypeExportIds.staticLifetime:
      return args.length === 0 ? { kind: "static-lifetime" } : undefined;
    case rustSourceTypeExportIds.placeholderLifetime:
      return args.length === 0 ? { kind: "placeholder-lifetime" } : undefined;
    case rustSourceTypeExportIds.sharedReference:
    case rustSourceTypeExportIds.mutableReference:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: exportId === rustSourceTypeExportIds.sharedReference
              ? "shared-reference"
              : "mutable-reference",
            targetTypeNode: args[0],
            ...(args[1] === undefined ? {} : { lifetimeTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.outlives:
    case rustSourceTypeExportIds.validFor:
      return args.length === 1 && args[0] !== undefined
        ? {
            kind: exportId === rustSourceTypeExportIds.outlives
              ? "outlives"
              : "valid-for",
            lifetimeTypeNode: args[0],
          }
        : undefined;
    case rustSourceTypeExportIds.dynamicTrait:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: "trait-object",
            traitTypeNode: args[0],
            ...(args[1] === undefined ? {} : { lifetimeTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.captureSet:
      return args.length === 1 && args[0] !== undefined
        ? { kind: "capture-set", tupleTypeNode: args[0] }
        : undefined;
    case rustSourceTypeExportIds.opaqueType:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: "opaque-type",
            boundTypeNode: args[0],
            ...(args[1] === undefined ? {} : { captureTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.maybeSized:
      return args.length === 0 ? { kind: "maybe-sized" } : undefined;
    default:
      return undefined;
  }
}

function writeTypeContract(
  subject: Node,
  fact: RustSourceTypeContractFact,
  context: RustSourceFileAnalysisContext,
): void {
  const result = context.facts.set(subject, rustSourceTypeContractFactKey, fact, [{
    message: "Rust lifetime type selected by exact provider declaration identity.",
  }]);
  if (result !== "inserted" && result !== "idempotent") {
    appendRustSourceDiagnostic(
      context,
      subject,
      "RUST_SOURCE_TYPE_FACT_WRITE_FAILED",
      9300102,
      `Rust lifetime type fact could not be recorded (${result}).`,
    );
  }
}

function analyzeTypeParameter(
  parameter: Node,
  context: RustSourceFileAnalysisContext,
): void {
  const declaration = context.ast.as.AsTypeParameterDeclaration(parameter);
  const owner = context.ast.parent(parameter);
  if (declaration === undefined || owner === undefined) return;
  const constraint = declaration.Constraint ?? undefined;
  const defaultType = declaration.DefaultType ?? undefined;
  const bounds = constraint === undefined
    ? Object.freeze([])
    : flattenConstraintBounds(constraint, context);
  if (bounds === undefined) {
    appendRustSourceDiagnostic(
      context,
      parameter,
      "RUST_SOURCE_GENERIC_BOUND_EVIDENCE_INVALID",
      9300103,
      "Rust lifetime bounds contain an undefined syntax slot.",
    );
    return;
  }
  const boundFacts = bounds.map((bound) => ({
    bound,
    fact: readRustSourceFact(context, bound, rustSourceTypeContractFactKey),
  }));
  const lifetime = boundFacts.some(({ fact }) => fact?.kind === "lifetime-kind");
  const fact: RustSourceGenericParameterFact = {
    parameter,
    owner,
    kind: lifetime ? "lifetime" : "type",
    ...(constraint === undefined ? {} : { constraint }),
    ...(defaultType === undefined ? {} : { defaultType }),
    bounds: Object.freeze(bounds),
    outlives: Object.freeze(boundFacts.flatMap(({ fact: boundFact }) =>
      boundFact?.kind === "outlives" ? [boundFact.lifetimeTypeNode] : [])),
    typeOutlives: Object.freeze(boundFacts.flatMap(({ fact: boundFact }) =>
      boundFact?.kind === "valid-for" ? [boundFact.lifetimeTypeNode] : [])),
    maybeSized: boundFacts.some(({ fact: boundFact }) =>
      boundFact?.kind === "maybe-sized"),
  };
  const result = context.facts.set(
    parameter,
    rustSourceGenericParameterFactKey,
    fact,
    [{ message: "Rust lifetime parameter and bounds derived from exact authored facts." }],
  );
  if (result !== "inserted" && result !== "idempotent") {
    appendRustSourceDiagnostic(
      context,
      parameter,
      "RUST_SOURCE_GENERIC_PARAMETER_FACT_WRITE_FAILED",
      9300104,
      `Rust lifetime parameter fact could not be recorded (${result}).`,
    );
  }
}

function flattenConstraintBounds(
  node: Node,
  context: RustSourceFileAnalysisContext,
): readonly Node[] | undefined {
  if (context.ast.is.IsParenthesizedTypeNode(node)) {
    const inner = context.ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined ? undefined : flattenConstraintBounds(inner, context);
  }
  if (!context.ast.is.IsIntersectionTypeNode(node)) return Object.freeze([node]);
  const raw = context.ast.as.AsIntersectionTypeNode(node)?.Types?.Nodes;
  if (raw === undefined || raw.some((bound) => bound === undefined)) return undefined;
  const flattened: Node[] = [];
  for (const bound of raw as readonly Node[]) {
    const selected = flattenConstraintBounds(bound, context);
    if (selected === undefined) return undefined;
    flattened.push(...selected);
  }
  return Object.freeze(flattened);
}

const rustSourceTypeContractExportIds = new Set<string>(
  Object.values(rustSourceTypeExportIds),
);
