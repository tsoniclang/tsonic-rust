import type { ProviderExportDeclaration, ProviderTypeExpression } from "@tsonic/tsts";
import type { RustCompilerDependency } from "../model/model.js";
import type { RustCompilerProviderProjection } from "./model.js";
import type { RustProviderOperationDefinition } from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustStringTargetType, rustUnitTargetType, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { compilerExportId } from "./operations.js";

type StandardMacro = "vec" | "vecRepeat" | "println" | "eprintln";

export interface RustStandardMacroRequest {
  readonly macros: readonly StandardMacro[];
  readonly compilerExports?: readonly string[];
}

export function rustStandardMacroRequest(
  dependency: RustCompilerDependency,
  modulePath: readonly string[],
  requestedExports: readonly string[] | undefined,
): RustStandardMacroRequest {
  const available: readonly StandardMacro[] = modulePath.length === 1 && modulePath[0] === "vec" &&
      (dependency.crateName === "std" || dependency.crateName === "alloc")
    ? ["vec", "vecRepeat"]
    : modulePath.length === 0 && dependency.crateName === "std" ? ["println", "eprintln"] : [];
  const macros = available.filter(name => requestedExports === undefined || requestedExports.includes(name));
  const compilerExports = requestedExports === undefined ? undefined
    : [...new Set([
        ...requestedExports.filter(name => !macros.some(macro => macro === name)),
        ...(macros.some(name => name === "vec" || name === "vecRepeat") ? ["Vec"] : []),
      ])].sort();
  return Object.freeze({ macros: Object.freeze(macros),
    ...(compilerExports === undefined ? {} : { compilerExports: Object.freeze(compilerExports) }) });
}

export function projectRustStandardMacros(
  projection: RustCompilerProviderProjection,
  dependency: RustCompilerDependency,
  modulePath: readonly string[],
  requested: readonly StandardMacro[],
): RustCompilerProviderProjection {
  if (requested.length === 0) return projection;
  const declarations: ProviderExportDeclaration[] = [...projection.module.exports];
  const operations: RustProviderOperationDefinition[] = [...projection.operations];
  for (const name of requested) {
    const exportId = compilerExportId(dependency, modulePath, name);
    if (declarations.some(declaration => declaration.id === exportId || declaration.name === name)) {
      throw new Error(`Standard macro facade '${name}' conflicts with a compiler export.`);
    }
    const signatureId = `${exportId}::macro-invocation`;
    if (name === "vec" || name === "vecRepeat") {
      const vector = projection.module.exports.find(declaration => declaration.name === "Vec");
      const type = vector === undefined ? undefined : projection.types.find(candidate => candidate.exportId === vector.id);
      const element = type?.genericParameters?.[0];
      if (vector === undefined || type === undefined || element?.kind !== "type") {
        throw new Error("The vector macro requires the selected compiler's exact Vec element type.");
      }
      const carrier: TargetTypeRef = { kind: "type-parameter", name: element.sourceName };
      const sourceType: ProviderTypeExpression = { kind: "type-parameter", name: element.sourceName };
      const defaults = new Map<string, TargetTypeRef>();
      for (const parameter of type.genericParameters?.slice(1) ?? []) {
        if (parameter.kind !== "type" || parameter.defaultArgument?.kind !== "type") {
          throw new Error("The vector macro's native default allocator contract is unavailable.");
        }
        defaults.set(parameter.sourceName, parameter.defaultArgument.type);
      }
      const resultCarrier = substituteRustTargetGenerics(type.targetCarrier, defaults, new Map());
      const count = { kind: "source-primitive", name: "native-uint" } as const;
      declarations.push({ id: exportId, name, kind: "function", signatures: [{ id: signatureId,
        typeParameters: [{ name: element.sourceName }],
        parameters: name === "vec"
          ? [{ name: "values", rest: true, type: { kind: "array", elementType: sourceType } }]
          : [{ name: "value", type: sourceType }, { name: "count", type: count }],
        returnType: { kind: "provider-ref", moduleSpecifier: projection.module.moduleSpecifier,
          exportName: vector.name, typeArguments: [sourceType] },
      }] });
      operations.push({ exportId, signatureId, operationKind: "method",
        target: { form: "expression-macro", path: `${dependency.targetCrateName}::vec`,
          delimiter: "brackets", arguments: name === "vec" ? "list" : "repeat" },
        resultCarrier, parameterCarriers: name === "vec" ? [carrier] : [carrier, count],
        genericParameters: [{ kind: "type", sourceName: element.sourceName }],
        ...(name === "vecRepeat" ? { typeRequirements: [{ name: element.sourceName, requirements: ["clone" as const] }] } : {}),
      });
    } else {
      declarations.push({ id: exportId, name, kind: "function", signatures: [{ id: signatureId,
        parameters: [{ name: "format", type: { kind: "string" } },
          { name: "values", rest: true, type: { kind: "array", elementType: { kind: "unknown" } } }],
        returnType: { kind: "void" },
      }] });
      operations.push({ exportId, signatureId, operationKind: "method",
        target: { form: "expression-macro", path: `${dependency.targetCrateName}::${name}`,
          delimiter: "parentheses", arguments: "format" },
        resultCarrier: rustUnitTargetType(), parameterCarriers: [rustStringTargetType()],
      });
    }
  }
  const module = Object.freeze({ ...projection.module, exports: Object.freeze(declarations) });
  return Object.freeze({ ...projection, module, declarationModel: module, operations: Object.freeze(operations) });
}
