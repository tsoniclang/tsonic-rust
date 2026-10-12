import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../../../analysis/program/model.js";
import { rustErrorEffectsFactKey, type RustErrorEffectsFact } from "../../../analysis/facts/error-effects.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import type { RustItem } from "../../target-ast/nodes.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { rustErrorType, rustNativeFallibleBoundary, rustPackageFallibleBoundary,
  type RustFallibleBoundary } from "./fallible-boundaries.js";
import { rustErrorBoundaryForDeclaration, type RustPlanContext } from "./plan-context.js";
import type { RustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import type { RustTargetConstArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustAsyncFunctionFactKey, rustGeneratorFactKey, rustSourceCallableReturnFactKey, rustSourceCallEffectsFactKey } from "../../../analysis/facts/keys.js";
import { rustNativeCallableCompletion } from "../../../target-model/types/callable-completions.js";
import type { RustType } from "../../target-ast/nodes.js";

export interface RustErrorRegionCatalog {
  nameFor(fileName: string, arity: number): string | undefined;
  itemsFor(fileName: string): readonly RustItem[];
  producerErrorType(reference: RustProducerErrorReference, context: RustTypeRenderingContext,
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
    producerErrorType(reference: RustProducerErrorReference, context: RustTypeRenderingContext,
      render: (carrier: TargetTypeRef) => RustType | undefined): RustType | undefined {
      const producer = program.callableValues.nativeProducers.forIdentity(reference.identity);
      if (producer === undefined || producer.fileName !== reference.fileName ||
        producer.environment.length !== reference.genericArguments.length) return undefined;
      const types = new Map<string, TargetTypeRef>();
      const lifetimes = new Map<string, RustLifetimeRef>();
      const consts = new Map<string, RustTargetConstArgument>();
      for (const [index, parameter] of producer.environment.entries()) {
        const argument = reference.genericArguments[index]!;
        if (parameter.kind === "type" && parameter.type.kind === "type-parameter" && argument.kind === "type")
          types.set(parameter.type.identity, argument.type);
        else if (parameter.kind === "lifetime" && argument.kind === "lifetime")
          lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
        else if (parameter.kind === "const" && parameter.value.kind === "parameter" && argument.kind === "const")
          consts.set(parameter.value.identity, argument.value);
        else return undefined;
      }
      const asynchronous = program.facts.getFact(producer.declaration, rustAsyncFunctionFactKey);
      const suspended = asynchronous !== undefined || program.facts.getFact(producer.declaration, rustGeneratorFactKey) !== undefined;
      const infallible: RustType = { kind: "named", path: "core::convert::Infallible" };
      if (reference.channel === "invoke" && suspended) return infallible;
      if (reference.channel !== "invoke") {
        const result = program.facts.getFact(producer.declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
        const completion = result === undefined ? undefined : rustNativeCallableCompletion(result, program.typeDefinitions);
        if (completion?.futures[reference.channel] === undefined) return undefined;
        if (asynchronous === undefined) {
          const effects = program.facts.getFact(producer.declaration, rustSourceCallEffectsFactKey);
          return effects?.awaiting === "infallible" ? infallible : undefined;
        }
      }
      const effects = program.facts.getFact(producer.declaration, rustErrorEffectsFactKey);
      if (effects === undefined) return undefined;
      const selected = planRustSelectedErrorRegion(producer.declaration, { ...effects,
        nativeErrors: effects.nativeErrors.map(source => ({ ...source,
          errorType: substituteRustTargetGenerics(source.errorType, types, lifetimes, consts) })),
      }, context, render);
      return selected === undefined ? undefined : selected.boundary?.errorType ?? infallible;
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
  const join = planRustNativeErrorJoin({ identity: nativeErrorJoinIdentity(fileName, arity), name, referencePath,
    visibility: "public", sources });
  const boundary = join === undefined ? undefined : rustNativeFallibleBoundary(join,
    owner === undefined || local === undefined ? undefined : { owner, source: local });
  return boundary === undefined ? undefined : Object.freeze({ boundary });
}

function nativeErrorJoinIdentity(fileName: string, arity: number): string {
  return `native-error-join:${fileName}:${arity}`;
}
