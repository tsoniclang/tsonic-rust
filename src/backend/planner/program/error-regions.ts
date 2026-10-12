import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import { rustErrorEffectsFactKey, type RustErrorEffectsFact } from "../../../analysis/facts/error-effects.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import type { RustItem } from "../../target-ast/nodes.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustErrorType, rustNativeFallibleBoundary, rustPackageFallibleBoundary,
  type RustFallibleBoundary } from "./fallible-boundaries.js";
import { rustErrorBoundaryForDeclaration, type RustPlanContext } from "./plan-context.js";

export interface RustErrorRegionCatalog {
  nameFor(fileName: string, arity: number): string | undefined;
  itemsFor(fileName: string): readonly RustItem[];
}

export function createRustErrorRegionCatalog(program: RustTargetProgram): RustErrorRegionCatalog {
  const { ast } = program.source;
  const names = new Map<string, ReadonlyMap<number, string>>();
  const declarations = new Map<string, readonly RustItem[]>();
  for (const file of program.sourceFiles) {
    const fileName = ast.getFileName(file);
    const usedNames = new Set<string>();
    const arities = new Set<number>();
    const visit = (node: Node): void => {
      for (const name of [program.names.nameForDeclaration(node), program.names.functionNameForDeclaration(node),
        program.names.callableValueNameForDeclaration(node)]) if (name !== undefined) usedNames.add(name);
      const effects = program.facts.getFact(node, rustErrorEffectsFactKey);
      if (effects !== undefined && effects.nativeErrors.length > 0) {
        const arity = effects.nativeErrors.length + (effects.localErrors ? 1 : 0);
        if (arity > 1) arities.add(arity);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
    for (const input of program.callableValues.native.inputs) {
      if (input.protocol.ownerFileName !== fileName) continue;
      usedNames.add(input.protocol.targetName);
      if (input.protocol.boundProducerName !== undefined) usedNames.add(input.protocol.boundProducerName);
    }
    const selected = new Map<number, string>();
    const items: RustItem[] = [];
    for (const arity of [...arities].sort((left, right) => left - right)) {
      const name = allocateRustGeneratedName(usedNames, `NativeErrors${arity}`);
      const plan = planRustNativeErrorJoin({ identity: nativeErrorJoinIdentity(fileName, arity), name,
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
  context: RustPlanContext,
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
    const errorType = rustTypeFromCarrierInContext(source.errorType, context);
    return errorType === undefined ? undefined : { identity: source.identity,
      variant: `Error${index + (owner === undefined ? 0 : 1)}`, errorType };
  });
  if (nativeSources.some(source => source === undefined)) return undefined;
  const local = owner === undefined ? undefined : { identity: `package:${owner.errorTypeIdentity}`,
    variant: "Error0", errorType: rustErrorType(owner) };
  const sources = [...(local === undefined ? [] : [local]), ...nativeSources as NonNullable<typeof nativeSources[number]>[]];
  const join = planRustNativeErrorJoin({ identity: nativeErrorJoinIdentity(fileName, arity), name, referencePath,
    visibility: "public", sources });
  const boundary = join === undefined ? undefined : rustNativeFallibleBoundary(join,
    owner === undefined || local === undefined ? undefined : { owner, source: local });
  return boundary === undefined ? undefined : Object.freeze({ boundary });
}

function nativeErrorJoinIdentity(fileName: string, arity: number): string {
  return `native-error-join:${fileName}:${arity}`;
}
