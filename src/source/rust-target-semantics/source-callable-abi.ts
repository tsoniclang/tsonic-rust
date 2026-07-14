import { selectedTargetSignatureFactKey } from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  SourceFile,
  TargetTypeRef,
} from "@tsonic/tsts";
import {
  createLazyTargetSourceAnalysis,
} from "@tsonic/target-api";
import type {
  TargetLazySourceAnalysis,
  TargetSourceUseRecord,
} from "@tsonic/target-api";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import {
  isRustStringCarrier,
} from "../rust-target-types.js";
import type { RustArgumentMode } from "../rust-facts/keys.js";
import {
  resolveRustTargetTypeRef,
} from "./target-type-resolution.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./target-type-resolution.js";

export interface RustSourceCallableAbiResolver {
  resolveParameterAbi(
    parameter: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
    analysis?: TargetLazySourceAnalysis,
  ): RustSourceParameterAbi | undefined;
}

export interface RustSourceParameterAbi {
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
}

interface CachedAnalysis {
  readonly sourceKey: string;
  readonly analysis: TargetLazySourceAnalysis;
}

export function createRustSourceCallableAbiResolver(): RustSourceCallableAbiResolver {
  const analyses = new WeakMap<object, CachedAnalysis>();
  return {
    resolveParameterAbi(parameter, context, options, suppliedAnalysis) {
      const base = resolveRustTargetTypeRef(parameter, context, options);
      if (base === undefined) {
        return undefined;
      }
      if (!isRustStringCarrier(base)) {
        return {
          valueCarrier: base,
          parameterCarrier: base,
          mode: base.kind === "pointer"
            ? base.mutability === "mut" ? "mut-ref" : "ref"
            : "value",
        };
      }
      const analysis = suppliedAnalysis ?? analysisFor(context);
      const borrows = analysis !== undefined && parameterOnlyBorrowsShared(
        parameter,
        analysis,
        context,
        options,
        new Set<object>(),
      );
      return borrows
        ? {
            valueCarrier: base,
            parameterCarrier: { kind: "pointer", pointee: base, mutability: "const" },
            mode: "ref",
          }
        : { valueCarrier: base, parameterCarrier: base, mode: "value" };
    },
  };

  function analysisFor(context: RustTargetTypeResolutionContext): TargetLazySourceAnalysis | undefined {
    const rawSourceFiles = context.compiler.getSourceFiles();
    if (!isDenseDataArray(rawSourceFiles) || rawSourceFiles.some((sourceFile) => sourceFile === undefined)) {
      return undefined;
    }
    const sourceFiles = (rawSourceFiles as readonly SourceFile[])
      .filter((sourceFile) => !context.compiler.ast.getFileName(sourceFile).endsWith(".d.ts"))
      .sort((left, right) => context.compiler.ast.getFileName(left).localeCompare(context.compiler.ast.getFileName(right)));
    const sourceKey = sourceFiles.map((sourceFile) => context.compiler.ast.getFileName(sourceFile)).join("\u0000");
    const checkerKey = context.compiler.checker as object;
    const cached = analyses.get(checkerKey);
    if (cached?.sourceKey === sourceKey) {
      return cached.analysis;
    }
    const analysis = createLazyTargetSourceAnalysis(
      context.compiler.ast,
      context.compiler.checker,
      sourceFiles,
    );
    analyses.set(checkerKey, { sourceKey, analysis });
    return analysis;
  }
}

function parameterOnlyBorrowsShared(
  parameter: Node,
  analysis: TargetLazySourceAnalysis,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): boolean {
  if (resolving.has(parameter)) {
    return false;
  }
  const { ast } = context.compiler;
  const name = ast.name(parameter);
  if (name === undefined) {
    return false;
  }
  const symbol = parameterSymbolForStructuralAnalysis(parameter, name, context);
  if (symbol === undefined) {
    return false;
  }
  resolving.add(parameter);
  try {
    const uses = analysis.usesOf(symbol).filter((use) =>
      use.node !== name && use.occurrence !== "type" && use.occurrence !== "namespace");
    return uses.length > 0 && uses.every((use) => useOnlyBorrowsShared(
      use,
      analysis,
      context,
      options,
      resolving,
    ));
  } finally {
    resolving.delete(parameter);
  }
}

function parameterSymbolForStructuralAnalysis(
  parameter: Node,
  name: Node,
  context: RustTargetTypeResolutionContext,
) {
  const sourceFile = context.compiler.ast.getSourceFile(parameter);
  return context.compiler.checker.getSymbolAtLocation(name, { sourceFile });
}

function useOnlyBorrowsShared(
  use: TargetSourceUseRecord,
  analysis: TargetLazySourceAnalysis,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): boolean {
  if (use.access !== "read") {
    return false;
  }
  if (use.operation === "property" || use.operation === "element") {
    return true;
  }
  if (use.operation === "call" && use.kind === "property-call" && use.base !== undefined) {
    return true;
  }
  if (use.operation !== "argument" || use.call === undefined || use.argumentIndex === undefined) {
    return false;
  }
  const selectedDeclaration = use.selectedSignatureDeclaration;
  if (selectedDeclaration !== undefined && isProjectSourceDeclaration(selectedDeclaration, context)) {
    const targetParameter = context.compiler.ast.parameters(selectedDeclaration)[use.argumentIndex];
    if (targetParameter === undefined) {
      return false;
    }
    const targetCarrier = resolveRustTargetTypeRef(targetParameter, context, options);
    return isRustStringCarrier(targetCarrier) && parameterOnlyBorrowsShared(
      targetParameter,
      analysis,
      context,
      options,
      resolving,
    );
  }
  const selected = context.factResolver.resolve(
    use.call as ExtensionFactSubject,
    selectedTargetSignatureFactKey,
  );
  const targetParameter = selected?.member.parameters[use.argumentIndex];
  return targetParameter?.passingMode === "borrow-shared" &&
    selectedParameterAcceptsString(targetParameter.type);
}

function selectedParameterAcceptsString(carrier: TargetTypeRef): boolean {
  return isRustStringCarrier(carrier) ||
    (carrier.kind === "pointer" && carrier.mutability !== "mut" && isRustStringCarrier(carrier.pointee));
}

function isProjectSourceDeclaration(
  declaration: Node,
  context: RustTargetTypeResolutionContext,
): boolean {
  const fileName = context.compiler.ast.getFileName(context.compiler.ast.getSourceFile(declaration));
  return fileName.length > 0 && !fileName.endsWith(".d.ts");
}
