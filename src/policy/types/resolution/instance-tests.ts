import type { Node } from "@tsonic/tsts";
import type { RustProjectTypePolicy } from "../project-types.js";
import type { RustTargetTypeResolutionOptions } from "./model.js";
import type { RustSourcePolicyContext } from "../../model/context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { resolveSelectedJsSourceExportName, resolveSelectedProviderDeclaration } from "../../evidence/selected-source.js";
import { resolveRustConstructInstance } from "./constructors.js";

export function resolveRustInstanceType(
  declaration: Node | undefined,
  constructor: Node,
  context: RustSourcePolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): TargetTypeRef | undefined {
  const definition = options.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind === "class") return definition.genericParameters.length === 0
    ? options.projectTypes.openCarrier(definition) : undefined;
  const profile = resolveSelectedJsSourceExportName(context, declaration, options.sourceProfiles);
  const provider = resolveSelectedProviderDeclaration(context, declaration);
  if (profile === undefined && provider.kind !== "selected") return undefined;
  const semantics = context.semanticsFor(constructor);
  const type = semantics.types.expressionType(constructor);
  const instance = type === undefined ? undefined : resolveRustConstructInstance(type,
    { ...context, currentSourceFile: semantics.sourceFile, currentSemantics: semantics }, options);
  return instance !== undefined && getRustTypeofRuntimeKind(instance, context.typeDefinitions) === "object"
    ? instance : undefined;
}
