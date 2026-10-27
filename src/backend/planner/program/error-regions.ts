import type { Node } from "@tsonic/tsts";
import type { RustErrorRegionSelection } from "../../../target-model/records/errors/error-regions.js";
import type { RustItem, RustType } from "../../target-ast/syntax/nodes.js";
import { planRustNativeErrorJoin, planRustNativeErrorRuntimeFrom } from "../types/native-error-joins.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { rustErrorType, rustNativeFallibleBoundary, rustPackageFallibleBoundary,
  type RustFallibleBoundary } from "./fallible-boundaries.js";
import { resolveRustPhysicalProgramErrorBoundary } from "./source-package-errors.js";
import { registerAliasFromPath, type RustPlanContext } from "./plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustNativeErrorJoinIdentity } from "../../../target-model/types/native-error-joins.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustJsRejectionRegion } from "./js-rejection-regions.js";
import { qualifyRustReferencePath, qualifyRustReferenceType } from "../../target-ast/syntax/type-paths.js";
import { rustSourcePackageReferenceScope } from "./source-package-components.js";

export function planRustErrorJoinDeclarations(sourceFile: import("@tsonic/tsts").SourceFile,
  input: import("../context.js").RustPlanningContext): readonly RustItem[] {
  const fileName = input.program.source.ast.getFileName(sourceFile);
  const selected = input.program.records.nativeErrorJoinDeclarations.get(fileName);
  if (selected === undefined) failRustPlannerInvariant("An admitted module requires its exact native error join declaration inventory.", sourceFile);
  return Object.freeze(selected.flatMap(declaration => {
    const join = planRustNativeErrorJoin({
      identity: rustNativeErrorJoinIdentity(fileName, declaration.arity), name: declaration.name,
      clone: declaration.clone, visibility: "public", resultShape: "result",
      sources: Array.from({ length: declaration.arity }, (_value, index) => ({
        identity: String(index), variant: `Error${index}`, errorType: { kind: "named", path: `Error${index}` },
      })),
    });
    if (join === undefined) failRustPlannerInvariant("An admitted native error join requires its complete syntax declaration.", sourceFile);
    const runtimeFrom = planRustNativeErrorRuntimeFrom(declaration);
    return runtimeFrom === undefined ? join.items : [...join.items, runtimeFrom];
  }));
}

export function planRustErrorRegion(
  declaration: Node,
  context: RustPlanContext,
): { readonly boundary: RustFallibleBoundary | undefined } | undefined {
  const selected = context.input.program.records.nativeErrorRegion.get(declaration);
  return selected === undefined ? undefined : selected.jsRejection === undefined || context.promiseBody === true
    ? planRustSelectedErrorRegion(selected, context, declaration) : planRustJsRejectionRegion(declaration, selected, context);
}

export function planRustSelectedErrorRegion(
  selected: RustErrorRegionSelection,
  context: RustTypeRenderingContext,
  sourceNode: Node | undefined,
  render: (carrier: TargetTypeRef) => RustType | undefined = carrier => rustTypeFromCarrierInContext(carrier, context),
  referenceCrate?: string,
): { readonly boundary: RustFallibleBoundary | undefined } | undefined {
  const references = referenceCrate === undefined ? undefined : rustSourcePackageReferenceScope(context, referenceCrate);
  const physicalOwner = selected.localOwner === undefined || context.sourcePackageErrors === undefined ? undefined
    : resolveRustPhysicalProgramErrorBoundary(context.input.program.records, context.sourcePackageComponentId, selected.localOwner);
  const owner = physicalOwner === undefined || references === undefined ? physicalOwner : {
    ...physicalOwner, errorTypePath: qualifyRustReferencePath(physicalOwner.errorTypePath, references),
  };
  if (selected.localOwner !== undefined && owner === undefined) failRustPlannerInvariant("An admitted native error region requires its exact physical package boundary.", sourceNode);
  if (owner !== undefined) registerAliasFromPath(context, owner.errorTypePath);
  if (selected.sources.length === 0 && selected.kind !== "native") return Object.freeze({ boundary: owner === undefined
    ? undefined : rustPackageFallibleBoundary(owner) });
  const arity = selected.sources.length + (owner === undefined ? 0 : 1);
  const name = context.input.program.records.nativeErrorJoinName.get(selected.fileName, arity);
  const moduleName = context.moduleNameByFileName.get(selected.fileName);
  if (name === undefined || moduleName === undefined) failRustPlannerInvariant("An admitted native error region requires its sealed join name and source module.", sourceNode);
  const external = context.externalCrateNameByFileName.get(selected.fileName);
  const selectedPath = `${external !== undefined && external !== context.crateName ? external : "crate"}::${moduleName}::${name}`;
  const referencePath = references === undefined ? selectedPath : qualifyRustReferencePath(selectedPath, references);
  const nativeSources = selected.sources.map(source => {
    const errorType = render(source.errorType);
    if (errorType === undefined) failRustPlannerInvariant("An admitted native error source requires its renderable finalized carrier.", sourceNode);
    return { ...source, errorType: references === undefined ? errorType : qualifyRustReferenceType(errorType, references) };
  });
  const local = owner === undefined ? undefined : { identity: `package:${owner.errorTypeIdentity}`,
    variant: "Error0", errorType: rustErrorType(owner) };
  const sources = [...(local === undefined ? [] : [local]), ...nativeSources];
  const join = planRustNativeErrorJoin({ identity: rustNativeErrorJoinIdentity(selected.fileName, arity), name, referencePath,
    visibility: "public", resultShape: "result", sources });
  const boundary = join === undefined ? undefined : rustNativeFallibleBoundary(join,
    owner === undefined || local === undefined ? undefined : { owner, source: local });
  return boundary === undefined ? undefined : Object.freeze({ boundary });
}
