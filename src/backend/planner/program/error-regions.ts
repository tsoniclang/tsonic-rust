import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import { rustErrorEffectsFactKey, type RustErrorEffectsFact } from "../../../analysis/facts/error-effects.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import type { RustItem } from "../../target-ast/syntax/nodes.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { rustErrorType, rustNativeFallibleBoundary, rustPackageFallibleBoundary,
  type RustFallibleBoundary } from "./fallible-boundaries.js";
import { rustErrorBoundaryForDeclaration, type RustPlanContext } from "./plan-context.js";
import type { RustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustContextualValueConversionFactKey } from "../../../analysis/facts/keys.js";
import { normalizeRustErrorType } from "../../../analysis/program/error-types.js";
import { rustProducerErrorTargetType } from "../../../target-model/types/carriers/producer-errors.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import { rustNativeErrorJoinIdentity, type RustNativeErrorJoinReference } from "../../../target-model/types/native-error-joins.js";
import { rustCallableConversionErrorArities } from "../../../target-model/conversions/callable-physical.js";
import type { RustCallableConversion } from "../../../target-model/conversions/callable.js";
import type { RustCallableValueAdapter } from "../../../analysis/facts/callable-adapters.js";
import { rustProjectCallableAdaptersKey } from "../../../analysis/facts/project-callable-adapters.js";
import { rustAsyncFunctionFactKey } from "../../../analysis/facts/keys.js";

export interface RustErrorRegionCatalog {
  nameFor(fileName: string, arity: number): string | undefined;
  itemsFor(fileName: string): readonly RustItem[];
  producerErrorType(reference: RustProducerErrorReference, context: RustTypeRenderingContext,
    render: (carrier: TargetTypeRef) => RustType | undefined): RustType | undefined;
  nativeErrorJoinType(reference: RustNativeErrorJoinReference, context: RustTypeRenderingContext,
    render: (carrier: TargetTypeRef) => RustType | undefined): RustType | undefined;
}

export function createRustErrorRegionCatalog(program: RustTargetProgram): RustErrorRegionCatalog {
  const { ast } = program.source;
  const names = new Map<string, ReadonlyMap<number, string>>();
  const declarations = new Map<string, readonly RustItem[]>();
  for (const file of program.sourceFiles) {
    const fileName = ast.getFileName(file);
    const usedNames = new Set<string>();
    const arities = new Set<number>();
    const clonedArities = new Set<number>();
    const registerConversion = (conversion: RustCallableConversion): void => {
      const selected = rustCallableConversionErrorArities(conversion, program.typeDefinitions);
      if (selected === undefined) throw new Error("Callable error joins require an exact sealed conversion contract.");
      for (const arity of selected) arities.add(arity);
    };
    const registerAdapter = (adapter: RustCallableValueAdapter, depth = 0): void => {
      if (depth > 128) throw new Error("Callable error joins exceed their bounded adapter depth.");
      if (adapter.kind === "conversion" && adapter.conversion.kind === "callable-adapter") registerConversion(adapter.conversion);
      else if (adapter.kind === "option-map" || adapter.kind === "option-some") registerAdapter(adapter.element, depth + 1);
    };
    const visit = (node: Node): void => {
      for (const name of [program.names.nameForDeclaration(node), program.names.functionNameForDeclaration(node),
        program.names.callableValueNameForDeclaration(node)]) if (name !== undefined) usedNames.add(name);
      const effects = program.facts.getFact(node, rustErrorEffectsFactKey);
      if (effects !== undefined && effects.nativeErrors.length > 0) {
        const arity = effects.nativeErrors.length + (effects.localErrors ? 1 : 0);
        if (arity > 1) arities.add(arity);
        if (program.facts.getFact(node, rustAsyncFunctionFactKey)?.kind === "js-promise") clonedArities.add(arity);
      }
      const conversion = program.facts.getFact(node, rustContextualValueConversionFactKey)?.conversion;
      if (conversion?.kind === "callable-adapter") registerConversion(conversion);
      for (const adapter of program.facts.getFact(node, rustProjectCallableAdaptersKey) ?? []) {
        registerAdapter(adapter.resultAdapter);
        for (const parameter of adapter.parameterAdapters) {
          if (parameter.kind === "runtime-value" || parameter.kind === "logical-value" || parameter.kind === "rest-element")
            registerAdapter(parameter.adapter);
          else if (parameter.kind === "rest") for (const segment of parameter.segments) registerAdapter(segment.adapter);
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
    const producerArities = program.callableValues.nativeGenericProducers.errorAritiesFor(fileName);
    if (producerArities === undefined) throw new Error("Native generic producers require sealed exact error channels.");
    for (const arity of producerArities) arities.add(arity);
    for (const input of program.callableValues.native.inputs) {
      if (input.protocol.ownerFileName !== fileName) continue;
      usedNames.add(input.protocol.targetName);
      if (input.protocol.boundProducerName !== undefined) usedNames.add(input.protocol.boundProducerName);
    }
    const selected = new Map<number, string>();
    const items: RustItem[] = [];
    for (const arity of [...arities].sort((left, right) => left - right)) {
      const name = allocateRustGeneratedName(usedNames, `NativeErrors${arity}`);
      const plan = planRustNativeErrorJoin({ identity: rustNativeErrorJoinIdentity(fileName, arity), name,
        clone: clonedArities.has(arity),
        visibility: "public", sources: Array.from({ length: arity }, (_value, index) => ({
          identity: String(index), variant: `Error${index}`, errorType: { kind: "named", path: `Error${index}` },
        })) });
      if (plan === undefined) throw new Error("Native error-region declarations require a valid exact payload arity.");
      selected.set(arity, name);
      items.push(...plan.items);
    }
    names.set(fileName, selected);
    declarations.set(fileName, Object.freeze(items));
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
      const selected = normalizeRustErrorType(rustProducerErrorTargetType(reference), {
        producers: program.callableValues.nativeProducers, facts: program.facts, definitions: program.typeDefinitions,
        ast, components: program.sourcePackageComponents,
      });
      return selected === undefined ? undefined : render(selected);
    },
  });
}

export function planRustErrorRegion(
  declaration: Node,
  context: RustPlanContext,
): { readonly boundary: RustFallibleBoundary | undefined } | undefined {
  const effects = context.input.program.facts.getFact(declaration, rustErrorEffectsFactKey);
  if (effects === undefined) return undefined;
  return planRustSelectedErrorRegion(declaration, effects, context);
}

export function planRustSelectedErrorRegion(
  declaration: Node,
  effects: RustErrorEffectsFact,
  context: RustTypeRenderingContext,
  render: (carrier: TargetTypeRef) => RustType | undefined = carrier => rustTypeFromCarrierInContext(carrier, context),
): { readonly boundary: RustFallibleBoundary | undefined } | undefined {
  const owner = effects.localErrors ? rustErrorBoundaryForDeclaration(declaration, context) : undefined;
  if (effects.localErrors && owner === undefined) return undefined;
  if (effects.nativeErrors.length === 0) return Object.freeze({ boundary: owner === undefined
    ? undefined : rustPackageFallibleBoundary(owner) });
  const file = context.input.program.source.ast.getSourceFile(declaration);
  if (file === undefined) return undefined;
  const fileName = context.input.program.source.ast.getFileName(file);
  const arity = effects.nativeErrors.length + (owner === undefined ? 0 : 1);
  const name = arity === 1 ? "NativeErrors1" : context.input.errorRegions.nameFor(fileName, arity);
  const moduleName = context.moduleNameByFileName.get(fileName);
  if (name === undefined || moduleName === undefined) return undefined;
  const external = context.externalCrateNameByFileName.get(fileName);
  const referencePath = `${external !== undefined && external !== context.crateName ? external : "crate"}::${moduleName}::${name}`;
  const nativeSources = effects.nativeErrors.map((source, index) => {
    const errorType = render(source.errorType);
    return errorType === undefined ? undefined : { identity: source.identity,
      variant: `Error${index + (owner === undefined ? 0 : 1)}`, errorType };
  });
  if (nativeSources.some(source => source === undefined)) return undefined;
  const local = owner === undefined ? undefined : { identity: `package:${owner.errorTypeIdentity}`,
    variant: "Error0", errorType: rustErrorType(owner) };
  const sources = [...(local === undefined ? [] : [local]), ...nativeSources as NonNullable<typeof nativeSources[number]>[]];
  const join = planRustNativeErrorJoin({ identity: rustNativeErrorJoinIdentity(fileName, arity), name, referencePath,
    visibility: "public", sources });
  const boundary = join === undefined ? undefined : rustNativeFallibleBoundary(join,
    owner === undefined || local === undefined ? undefined : { owner, source: local });
  return boundary === undefined ? undefined : Object.freeze({ boundary });
}
