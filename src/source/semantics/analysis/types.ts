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
    selected.exportId === undefined) {
    return;
  }
  if (!rustSourceTypeContractExportIds.has(selected.exportId)) {
    return;
  }
  const rawArguments = context.ast.typeArguments(node);
  if (rawArguments.some((argument) => argument === undefined)) {
    appendRustSourceDiagnostic(
      context,
      node,
      "RUST_SOURCE_TYPE_ARGUMENT_EVIDENCE_INVALID",
      9300101,
      "Rust semantic type arguments contain an undefined syntax slot.",
      [{ message: "The authored Rust semantic type argument list must be dense." }],
    );
    return;
  }
  const args = rawArguments as readonly Node[];
  const fact = typeContractFor(selected.exportId, args);
  if (fact === undefined) {
    appendRustSourceDiagnostic(
      context,
      node,
      "RUST_SOURCE_TYPE_ARGUMENT_EVIDENCE_INVALID",
      9300101,
      `Rust semantic type '${selected.exportId}' does not have its required authored type arguments.`,
      [{
        message: "The exact selected Rust source declaration was found, but its authored argument shape is incomplete.",
        details: { exportId: selected.exportId, argumentCount: args.length },
      }],
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
    case rustSourceTypeExportIds.owned:
      return args.length === 1 && args[0] !== undefined
        ? { kind: "owned", targetTypeNode: args[0] }
        : undefined;
    case rustSourceTypeExportIds.sharedReference:
    case rustSourceTypeExportIds.mutableReference: {
      const targetTypeNode = args[0];
      const lifetimeTypeNode = args[1];
      if (targetTypeNode === undefined || args.length > 2) return undefined;
      return {
        kind: exportId === rustSourceTypeExportIds.sharedReference
          ? "shared-reference"
          : "mutable-reference",
        targetTypeNode,
        ...(lifetimeTypeNode === undefined ? {} : { lifetimeTypeNode }),
      };
    }
    case rustSourceTypeExportIds.outlives:
      return args.length === 1 && args[0] !== undefined
        ? { kind: "outlives", lifetimeTypeNode: args[0] }
        : undefined;
    case rustSourceTypeExportIds.validFor:
      return args.length === 1 && args[0] !== undefined
        ? { kind: "valid-for", lifetimeTypeNode: args[0] }
        : undefined;
    case rustSourceTypeExportIds.constParameter:
      return args.length === 1 && args[0] !== undefined
        ? { kind: "const-parameter", valueTypeNode: args[0] }
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
    case rustSourceTypeExportIds.functionPointer:
      return args.length >= 2 && args.length <= 5 &&
          args[0] !== undefined && args[1] !== undefined
        ? {
            kind: "function-pointer",
            parameterTypesNode: args[0],
            resultTypeNode: args[1],
            ...(args[2] === undefined ? {} : { abiTypeNode: args[2] }),
            ...(args[3] === undefined ? {} : { safetyTypeNode: args[3] }),
            ...(args[4] === undefined ? {} : { variadicTypeNode: args[4] }),
          }
        : undefined;
    case rustSourceTypeExportIds.rustChar:
      return args.length === 0 ? { kind: "rust-char" } : undefined;
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
    message: "Rust source type contract selected by exact provider declaration identity.",
  }]);
  if (result !== "inserted" && result !== "idempotent") {
    appendRustSourceDiagnostic(
      context,
      subject,
      "RUST_SOURCE_TYPE_FACT_WRITE_FAILED",
      9300102,
      `Rust source type contract could not be recorded (${result}).`,
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
  const intersectionTypes = constraint !== undefined &&
      context.ast.is.IsIntersectionTypeNode(constraint)
    ? context.ast.as.AsIntersectionTypeNode(constraint)?.Types?.Nodes
    : undefined;
  if (intersectionTypes?.some((node) => node === undefined)) {
    appendRustSourceDiagnostic(
      context,
      parameter,
      "RUST_SOURCE_GENERIC_BOUND_EVIDENCE_INVALID",
      9300104,
      "Rust generic parameter bounds contain an undefined syntax slot.",
    );
    return;
  }
  const bounds = constraint === undefined
    ? []
    : intersectionTypes === undefined
      ? [constraint]
      : intersectionTypes as readonly Node[];
  const boundFacts = bounds.map((bound) => ({
    bound,
    fact: context.facts.get(bound, rustSourceTypeContractFactKey),
  }));
  const lifetime = boundFacts.some(({ fact }) => fact?.kind === "lifetime-kind");
  const constBound = boundFacts.find(({ fact }) => fact?.kind === "const-parameter");
  const fact: RustSourceGenericParameterFact = {
    parameter,
    owner,
    kind: lifetime ? "lifetime" : constBound === undefined ? "type" : "const",
    ...(constraint === undefined ? {} : { constraint }),
    ...(defaultType === undefined ? {} : { defaultType }),
    bounds: Object.freeze(bounds),
    ...(constBound?.fact?.kind === "const-parameter"
      ? { constValueType: constBound.fact.valueTypeNode }
      : {}),
    outlives: Object.freeze(boundFacts.flatMap(({ fact }) =>
      fact?.kind === "outlives" ? [fact.lifetimeTypeNode] : [])),
    typeOutlives: Object.freeze(boundFacts.flatMap(({ fact }) =>
      fact?.kind === "valid-for" ? [fact.lifetimeTypeNode] : [])),
    maybeSized: boundFacts.some(({ fact }) => fact?.kind === "maybe-sized"),
  };
  const result = context.facts.set(parameter, rustSourceGenericParameterFactKey, fact, [{
    message: "Rust generic parameter kind and bounds derived from exact authored constraint facts.",
  }]);
  if (result !== "inserted" && result !== "idempotent") {
    appendRustSourceDiagnostic(
      context,
      parameter,
      "RUST_SOURCE_GENERIC_PARAMETER_FACT_WRITE_FAILED",
      9300103,
      `Rust generic parameter contract could not be recorded (${result}).`,
    );
  }
}

const rustSourceTypeContractExportIds = new Set<string>([
  rustSourceTypeExportIds.life,
  rustSourceTypeExportIds.staticLifetime,
  rustSourceTypeExportIds.owned,
  rustSourceTypeExportIds.sharedReference,
  rustSourceTypeExportIds.mutableReference,
  rustSourceTypeExportIds.outlives,
  rustSourceTypeExportIds.validFor,
  rustSourceTypeExportIds.constParameter,
  rustSourceTypeExportIds.dynamicTrait,
  rustSourceTypeExportIds.captureSet,
  rustSourceTypeExportIds.opaqueType,
  rustSourceTypeExportIds.maybeSized,
  rustSourceTypeExportIds.functionPointer,
  rustSourceTypeExportIds.rustChar,
]);
