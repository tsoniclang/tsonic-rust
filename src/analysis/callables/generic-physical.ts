import { createHash } from "node:crypto";
import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import type { RustGenericCallableStorageMember } from "../../target-model/types/carriers/generic-callable-storage.js";
import { rustGenericCallableEnvironment, type RustGenericCallableEnvironment } from "./generic-environments.js";
import type { RustNativeCapturePlan } from "./native-captures.js";
import type { RustNativeCallableInput, RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeStorageSelection } from "./native-storage.js";
import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "./generic-values.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

export interface RustGenericCallablePhysicalMember {
  readonly implementation: RustGenericCallableImplementation;
  readonly variantName: string;
  readonly arguments: readonly RustTargetGenericArgument[];
}

export interface RustGenericCallablePhysicalDefinition extends RustGenericCallableDefinition {
  readonly familyIdentity: string;
  readonly parameters: readonly RustTargetGenericArgument[];
  readonly members: readonly RustGenericCallablePhysicalMember[];
  readonly carrier: TargetTypeRef;
}

export interface RustGenericCallablePhysicalPlan {
  definitions(): readonly RustGenericCallablePhysicalDefinition[];
  environmentFor(implementation: RustGenericCallableImplementation): RustGenericCallableEnvironment | undefined;
  definitionFor(carrier: TargetTypeRef): RustGenericCallablePhysicalDefinition | undefined;
  argumentsFor(carrier: TargetTypeRef): readonly RustTargetGenericArgument[] | undefined;
  carrierFor(carrier: TargetTypeRef, ownerFileName: string, producers: readonly SourceStorageProducer[]):
    { readonly carrier: TargetTypeRef; readonly inputs: readonly RustNativeCallableInput[] } | undefined;
}

export interface RustGenericCallablePhysicalInput {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly captures: RustNativeCapturePlan;
  readonly native: RustNativeCallableInputPlan;
  readonly boundSubjectFor: (subject: SourceStorageSubject, carrier: TargetTypeRef, bindings: SourceStorageBindings) => RustNativeStorageSelection;
}

export function createRustGenericCallablePhysicalPlan(
  families: readonly RustGenericCallableDefinition[],
  familyFor: (carrier: TargetTypeRef) => RustGenericCallableDefinition | undefined,
  input: RustGenericCallablePhysicalInput,
): RustGenericCallablePhysicalPlan {
  const implementations = new Map<Node, RustGenericCallableImplementation>();
  const origins = new Map<RustGenericCallableImplementation, RustGenericCallableStorageMember["origin"]>();
  const byOrigin = new Map<string, RustGenericCallableImplementation>();
  const environments = new Map<RustGenericCallableImplementation, RustGenericCallableEnvironment | null>();
  const definitions = new Map<string, RustGenericCallablePhysicalDefinition>();
  const selectedCarriers = new Map<string, { readonly definition: RustGenericCallablePhysicalDefinition;
    readonly arguments: readonly RustTargetGenericArgument[] }>();
  const nativeInputs = new Map(input.native.inputs.map(value => [value.implementation.identity, value]));
  const sourceFiles = new Set(input.storage.nodes.filter(node => input.ast.is.IsSourceFile(node)).map(node => input.ast.getFileName(input.ast.getSourceFile(node))));
  const usedNames = new Set(families.flatMap(family => [family.targetName,
    ...family.implementations.flatMap(value => [value.stateName, value.functionName, value.variantName])]));
  for (const family of families) for (const implementation of family.implementations) {
    implementations.set(implementation.declaration, implementation);
    const declarationIdentity = sourceNodeIdentity(input.ast, implementation.declaration);
    if (declarationIdentity === undefined) continue;
    const origin = Object.freeze({ fileName: implementation.sourceFileName, declarationIdentity });
    origins.set(implementation, origin);
    byOrigin.set(closedMetadataKey(origin), implementation);
  }
  const environmentFor = (implementation: RustGenericCallableImplementation): RustGenericCallableEnvironment | undefined => {
    if (implementations.get(implementation.declaration) !== implementation) return undefined;
    const previous = environments.get(implementation);
    if (previous !== undefined) return previous ?? undefined;
    environments.set(implementation, null);
    const result = rustGenericCallableEnvironment(implementation, input.captures.forDeclaration(implementation.declaration));
    environments.set(implementation, result ?? null);
    return result;
  };
  const select = (carrier: TargetTypeRef): { readonly definition: RustGenericCallablePhysicalDefinition;
    readonly arguments: readonly RustTargetGenericArgument[] } | undefined => {
    const value = rustGenericCallableValue(carrier);
    const family = value === undefined ? undefined : familyFor(carrier);
    if (value === undefined || family === undefined) return undefined;
    const cacheKey = closedMetadataKey(carrier);
    const cached = selectedCarriers.get(cacheKey);
    if (cached !== undefined) return cached;
    const physical = value.physical;
    const members = physical?.members ?? family.implementations.map(implementation => ({
      origin: origins.get(implementation)!, arguments: [] as readonly number[],
    }));
    const actuals = physical?.arguments ?? [];
    const parameters: RustTargetGenericArgument[] = actuals.map((argument, index) => {
      const identity = `generic-callable:physical:${index}`;
      return argument.kind === "type"
        ? { kind: "type", type: { kind: "type-parameter", identity, name: `PhysicalType${index}` } }
        : argument.kind === "lifetime"
          ? { kind: "lifetime", lifetime: { kind: "parameter", identity, name: `physical${index}` } }
          : { kind: "const", value: { kind: "parameter", identity, name: `PhysicalConst${index}` } };
    });
    const selected: RustGenericCallablePhysicalMember[] = [];
    const variantNames = new Set<string>();
    for (const member of members) {
      if (member.origin === undefined) return undefined;
      const implementation = byOrigin.get(closedMetadataKey(member.origin));
      const environment = implementation === undefined ? undefined : environmentFor(implementation);
      if (implementation === undefined || environment === undefined || !family.implementations.includes(implementation) ||
        environment.parameters.length !== member.arguments.length ||
        environment.parameters.some((parameter, index) => parameter.kind !== parameters[member.arguments[index]!]!.kind)) return undefined;
      const arguments_ = member.arguments.map(index => parameters[index]!);
      selected.push(Object.freeze({ implementation,
        variantName: allocateRustGeneratedName(variantNames, implementation.variantName), arguments: snapshotClosedMetadata(arguments_) }));
    }
    const ownerFileName = selected.length === 1 ? selected[0]!.implementation.sourceFileName
      : physical?.ownerFileName ?? family.ownerFileName;
    if (!sourceFiles.has(ownerFileName) || physical !== undefined && physical.ownerFileName !== ownerFileName) return undefined;
    const identity = closedMetadataKey({ family: family.identity, ownerFileName,
      members, parameters: parameters.map(parameter => parameter.kind) });
    let definition = definitions.get(identity);
    if (definition === undefined) {
      const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 12);
      definition = Object.freeze({ ...family, identity, familyIdentity: family.identity, ownerFileName,
        targetName: allocateRustGeneratedName(usedNames, `GenericCallable${suffix}`),
        ...(family.nativeFutureDispatchName === undefined ? {} : {
          nativeFutureDispatchName: allocateRustGeneratedName(usedNames, `CallableFuture${suffix}`) }),
        implementations: Object.freeze(selected.map(member => member.implementation)),
        parameters: snapshotClosedMetadata(parameters), members: Object.freeze(selected),
        carrier: rustGenericCallableCarrier({ origin: family.origin, signature: family.signature,
          environment: family.signature.environmentParameters,
          physical: { ownerFileName, members, arguments: parameters } }),
      });
      definitions.set(identity, definition);
    }
    const result = Object.freeze({ definition, arguments: snapshotClosedMetadata(actuals) });
    selectedCarriers.set(cacheKey, result);
    return result;
  };
  return Object.freeze({
    definitions: () => Object.freeze([...definitions.values()]), environmentFor,
    definitionFor: (carrier: TargetTypeRef) => select(carrier)?.definition,
    argumentsFor: (carrier: TargetTypeRef) => select(carrier)?.arguments,
    carrierFor(carrier: TargetTypeRef, ownerFileName: string, producers: readonly SourceStorageProducer[]) {
      const value = rustGenericCallableValue(carrier);
      const family = value === undefined ? undefined : familyFor(carrier);
      if (value === undefined || family === undefined || producers.length === 0) return undefined;
      const members = new Map<string, RustGenericCallableStorageMember>();
      const arguments_: RustTargetGenericArgument[] = [];
      const argumentIndexes = new Map<string, number>();
      const selectedInputs = new Set<RustNativeCallableInput>();
      for (const producer of producers) {
        if (input.storage.boundOriginsFor(producer.subject, producer.bindings).kind === "unresolved") return undefined;
        if (producer.subject.projection.length !== 0) return undefined;
        const implementation = implementations.get(producer.subject.node);
        const environment = implementation === undefined ? undefined : environmentFor(implementation);
        const origin = implementation === undefined ? undefined : origins.get(implementation);
        const original = implementation === undefined ? undefined : rustGenericCallableValue(implementation.carrier);
        if (implementation === undefined || environment === undefined || origin === undefined || original === undefined ||
          !family.implementations.includes(implementation) || original.environment.length !== value.environment.length) return undefined;
        const substitutions = new Map(original.environment.flatMap((argument, index): [string, TargetTypeRef][] =>
          argument.kind === "type-parameter" ? [[argument.identity, value.environment[index]!]] : []));
        const memberArguments: RustTargetGenericArgument[] = [];
        for (const argument of environment.arguments) {
          if (argument.kind !== "type" || argument.type.kind !== "type-parameter") {
            memberArguments.push(argument);
            continue;
          }
          const selectedInput = nativeInputs.get(argument.type.identity);
          if (selectedInput === undefined) return undefined;
          const selected = input.boundSubjectFor(selectedInput.subject,
            substituteRustTargetTypeParameters(selectedInput.carrier, substitutions), producer.bindings);
          if (selected.kind === "unresolved") return undefined;
          if (selected.kind === "selected") for (const sourceInput of selected.inputs) selectedInputs.add(sourceInput);
          memberArguments.push(Object.freeze({ kind: "type", type: selected.carrier }));
        }
        const indexes = memberArguments.map(argument => {
          const key = closedMetadataKey(argument);
          const existing = argumentIndexes.get(key);
          if (existing !== undefined) return existing;
          const index = arguments_.length;
          argumentIndexes.set(key, index);
          arguments_.push(argument);
          return index;
        });
        const member = snapshotClosedMetadata({ origin, arguments: indexes });
        members.set(closedMetadataKey(member), member);
      }
      const selected = [...members.values()];
      const physicalOwner = selected.length === 1 ? selected[0]!.origin.fileName : ownerFileName;
      const result = rustGenericCallableCarrier({ ...value, physical: { ownerFileName: physicalOwner, members: selected, arguments: arguments_ } });
      return select(result) === undefined ? undefined : Object.freeze({ carrier: result, inputs: Object.freeze([...selectedInputs]) });
    },
  });
}
