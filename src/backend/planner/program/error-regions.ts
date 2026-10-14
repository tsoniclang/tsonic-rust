import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import type { RustErrorRegionSelection } from "../../../target-model/records/error-regions.js";
import type { RustItem, RustType } from "../../target-ast/syntax/nodes.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { rustErrorType, rustNativeFallibleBoundary, rustPackageFallibleBoundary,
  type RustFallibleBoundary } from "./fallible-boundaries.js";
import { resolveRustPhysicalProgramErrorBoundary } from "./source-package-errors.js";
import type { RustPlanContext } from "./plan-context.js";
import type { RustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustNativeErrorJoinIdentity, type RustNativeErrorJoinReference } from "../../../target-model/types/native-error-joins.js";

export interface RustErrorRegionCatalog {
  nameFor(fileName: string, arity: number): string | undefined;
  itemsFor(fileName: string): readonly RustItem[];
  producerErrorType(reference: RustProducerErrorReference, context: RustTypeRenderingContext,
    render: (carrier: TargetTypeRef) => RustType | undefined): RustType | undefined;
  nativeErrorJoinType(reference: RustNativeErrorJoinReference, context: RustTypeRenderingContext,
    render: (carrier: TargetTypeRef) => RustType | undefined): RustType | undefined;
}

export function createRustErrorRegionCatalog(program: RustTargetProgram): RustErrorRegionCatalog {
  const names = new Map<string, ReadonlyMap<number, string>>();
  const declarations = new Map<string, readonly RustItem[]>();
  for (const file of program.sourceFiles) {
    const fileName = program.source.ast.getFileName(file);
    const selected = program.errorRegions.declarationsFor(fileName);
    names.set(fileName, new Map(selected.map(declaration => [declaration.arity, declaration.name])));
    declarations.set(fileName, Object.freeze(selected.flatMap(declaration => planRustNativeErrorJoin({
      identity: rustNativeErrorJoinIdentity(fileName, declaration.arity), name: declaration.name,
      clone: declaration.clone, visibility: "public",
      sources: Array.from({ length: declaration.arity }, (_value, index) => ({
        identity: String(index), variant: `Error${index}`, errorType: { kind: "named", path: `Error${index}` },
      })),
    })!.items)));
  }
  const empty: readonly RustItem[] = Object.freeze([]);
  return Object.freeze({
    nameFor: (fileName: string, arity: number) => names.get(fileName)?.get(arity),
    itemsFor: (fileName: string) => declarations.get(fileName) ?? empty,
    nativeErrorJoinType(reference: RustNativeErrorJoinReference, context: RustTypeRenderingContext,
      render: (carrier: TargetTypeRef) => RustType | undefined): RustType | undefined {
      const arity = reference.errors.length;
      const name = names.get(reference.fileName)?.get(arity);
      const moduleName = context.moduleNameByFileName.get(reference.fileName);
      const external = context.externalCrateNameByFileName.get(reference.fileName);
      if (name === undefined || moduleName === undefined) return undefined;
      const errors = reference.errors.map(render);
      if (errors.some(error => error === undefined)) return undefined;
      return planRustNativeErrorJoin({ identity: rustNativeErrorJoinIdentity(reference.fileName, arity), name,
        referencePath: `${external !== undefined && external !== context.crateName ? external : "crate"}::${moduleName}::${name}`,
        visibility: "public", sources: (errors as RustType[]).map((errorType, index) => ({
          identity: String(index), variant: `Error${index}`, errorType,
        })) })?.errorType;
    },
    producerErrorType(reference: RustProducerErrorReference, _context: RustTypeRenderingContext,
      render: (carrier: TargetTypeRef) => RustType | undefined): RustType | undefined {
      const selected = program.errorRegions.producerError(reference);
      return selected === undefined ? undefined : render(selected);
    },
  });
}

export function planRustErrorRegion(
  declaration: Node,
  context: RustPlanContext,
): { readonly boundary: RustFallibleBoundary | undefined } | undefined {
  const selected = context.input.program.errorRegions.get(declaration);
  return selected === undefined ? undefined : planRustSelectedErrorRegion(selected, context);
}

export function planRustSelectedErrorRegion(
  selected: RustErrorRegionSelection,
  context: RustTypeRenderingContext,
  render: (carrier: TargetTypeRef) => RustType | undefined = carrier => rustTypeFromCarrierInContext(carrier, context),
): { readonly boundary: RustFallibleBoundary | undefined } | undefined {
  const owner = selected.localOwner === undefined || context.sourcePackageErrors === undefined ? undefined
    : resolveRustPhysicalProgramErrorBoundary(context.sourcePackageErrors, context.sourcePackageComponentId, selected.localOwner);
  if (selected.localOwner !== undefined && owner === undefined) return undefined;
  if (selected.sources.length === 0) return Object.freeze({ boundary: owner === undefined
    ? undefined : rustPackageFallibleBoundary(owner) });
  const arity = selected.sources.length + (owner === undefined ? 0 : 1);
  const name = arity === 1 ? "NativeErrors1" : context.input.errorRegions.nameFor(selected.fileName, arity);
  const moduleName = context.moduleNameByFileName.get(selected.fileName);
  if (name === undefined || moduleName === undefined) return undefined;
  const external = context.externalCrateNameByFileName.get(selected.fileName);
  const referencePath = `${external !== undefined && external !== context.crateName ? external : "crate"}::${moduleName}::${name}`;
  const nativeSources = selected.sources.map(source => {
    const errorType = render(source.errorType);
    return errorType === undefined ? undefined : { ...source, errorType };
  });
  if (nativeSources.some(source => source === undefined)) return undefined;
  const local = owner === undefined ? undefined : { identity: `package:${owner.errorTypeIdentity}`,
    variant: "Error0", errorType: rustErrorType(owner) };
  const sources = [...(local === undefined ? [] : [local]), ...nativeSources as NonNullable<typeof nativeSources[number]>[]];
  const join = planRustNativeErrorJoin({ identity: rustNativeErrorJoinIdentity(selected.fileName, arity), name, referencePath,
    visibility: "public", sources });
  const boundary = join === undefined ? undefined : rustNativeFallibleBoundary(join,
    owner === undefined || local === undefined ? undefined : { owner, source: local });
  return boundary === undefined ? undefined : Object.freeze({ boundary });
}
