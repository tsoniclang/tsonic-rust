import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import type { Node, Type } from "@tsonic/tsts";
import type { RustCheckedCallSelectionInput } from "../../policy/model/contracts.js";
import type { RustOperationsProviderOptions } from "../operations/members/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustOptionElementCarrier, rustJsValueTargetType } from "../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { selectRustStructuralFieldProjection } from "../../policy/types/objects/structural-fields.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { selectRustProjectedValueConversion } from "../../policy/conversions/property-projection.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { resolveRustProjectField } from "../operations/members/project-fields.js";
import type { RustProjectFieldSelection } from "../../target-model/records/objects/project-fields.js";
import { resolveRustProjectAccessor } from "../operations/members/project-accessors.js";
import type { RustProjectAccessorSelection } from "../../target-model/records/objects/project-accessors.js";

import type { RustPropertyProjectionCase, RustPropertyProjectionFact } from "../../target-model/records/objects/property-projections.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import { rustPropertyProjectionFactEquals } from "../../target-model/records/operations/operation-equality.js";

const maximumPropertyProjectionMembers = 1_048_576;

export function createRustPropertyProjectionSelector(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  carriers: readonly (TargetTypeRef | undefined)[],
): (argumentIndex: number) => RustValueConversion | undefined {
  const cache = new Map<number, RustPropertyProjectionFact | undefined>();
  let accounting = 0;
  return argumentIndex => {
    context.records.propertyProjections.assertOpen();
    if (cache.has(argumentIndex)) return cache.get(argumentIndex)?.conversion;
    const argument = request.source.sourceArguments[argumentIndex];
    const carrier = carriers[argumentIndex];
    const bindings = request.source.sourceArgumentBindings.filter(binding => binding.sourceArgumentIndex === argumentIndex);
    const binding = bindings.length === 1 ? bindings[0] : undefined;
    const types = context.currentSemantics.types;
    const destination = binding === undefined ? undefined : types.nonNullableType(binding.selectedParameterType);
    if (argument === undefined || carrier === undefined || binding?.sourceForm !== "value" || destination === undefined) return undefined;
    const cases: RustPropertyProjectionCase[] = [];
    const sourceTypes: Type[] = [];
    const pending = [argument.type];
    const visited = new Set<Type>();
    while (pending.length > 0) {
      const type = pending.pop()!;
      if (visited.has(type)) continue;
      visited.add(type);
      if (++accounting > maximumPropertyProjectionMembers) return undefined;
      if (types.isNullish(type)) continue;
      if (types.isUnion(type)) pending.push(...types.unionOrIntersectionTypes(type));
      else sourceTypes.push(type);
    }
    const selectedConversion = selectRustProjectedValueConversion(carrier, "properties", context.typeDefinitions, source => {
      const rootCarrier = rustOptionElementCarrier(carrier) ?? carrier;
      const selected = rustTargetTypeRefEquals(rootCarrier, source) ? sourceTypes : sourceTypes.filter(type => {
        const resolved = resolveRustTargetTypeRef(type, context, options);
        return resolved !== undefined && rustTargetTypeRefEquals(resolved, source);
      });
      if (selected.length !== 1) return undefined;
      const projection = selectRustPropertyProjectionCase(selected[0]!, destination, source, context, options,
        () => ++accounting <= maximumPropertyProjectionMembers);
      if (projection === undefined) return undefined;
      cases.push(projection);
      return projection.conversion;
    });
    if (selectedConversion === undefined) {
      cache.set(argumentIndex, undefined);
      return undefined;
    }
    requireRustRecord(context.requiredRecords, "propertyProjection", argument.expression, "projected-value", "createRustPropertyProjectionSelector");
    const selected = Object.freeze({ conversion: selectedConversion, cases: Object.freeze(cases) });
    let canonical = context.records.propertyProjection.get(argument.expression);
    if (canonical !== undefined) {
      if (!rustPropertyProjectionFactEquals(canonical, selected)) return undefined;
    } else {
      if (context.records.propertyProjections.finalize(argument.expression, selectedConversion, cases) === undefined) return undefined;
      canonical = context.records.propertyProjection.get(argument.expression)!;
    }
    cache.set(argumentIndex, canonical);
    return canonical.conversion;
  };
}

export function selectRustPropertyProjectionCase(
  sourceType: Type,
  destination: Type,
  source: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  reserve: () => boolean,
): RustPropertyProjectionCase | undefined {
  const correspondence = context.currentSemantics.types.structuralMembers(sourceType, destination, "read");
  if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== 0 || correspondence.destination.indexes.length !== 0) return undefined;
  const fields: Extract<RustValueConversion, { readonly kind: "js-value-from-properties" }>["fields"][number][] = [];
  const reads: (RustProjectFieldSelection | RustProjectAccessorSelection)[] = [];
  for (const pair of correspondence.members) {
    if (!reserve()) return undefined;
    if (pair.kind === "absent") {
      if (!pair.destination.property.optional) return undefined;
      continue;
    }
    if (pair.destination.read !== "property" || pair.source.read === "method" || pair.source.read === "unavailable") return undefined;
    const structural = selectRustStructuralFieldProjection(options.sourceTypes,
      pair.source.property.symbol, pair.source.declarations, source);
    const declarations = pair.source.declarations.filter(declaration =>
      options.projectTypes.definitionContainingDeclaration(declaration) !== undefined);
    const read = structural !== undefined ? {
      kind: "source-field" as const, receiverCarrier: source, storage: structural.shape.storage,
      storageIndex: structural.field.storageIndex, resultCarrier: structural.field.resultCarrier,
      ...(pair.source.getters[0] === undefined ? {} : { declaration: pair.source.getters[0] }),
      valueSemantics: structural.field.accessor === undefined
        ? { kind: "stored" as const } : { kind: "accessor" as const, writable: structural.field.accessor.setter },
    } : pair.source.read === "accessor" && pair.source.getters.length === 1
      ? resolveRustProjectAccessor({ readDeclaration: pair.source.getters[0],
          sourceReceiverType: sourceType, sourceReadType: pair.source.property.type }, source, context, options)
      : declarations.length === 1 ? resolveRustProjectField(declarations[0]!, source, sourceType, context, options) : undefined;
    if (read === undefined) return undefined;
    const presence = pair.source.property.optional ? "optional" : "required";
    const fieldCarrier = presence === "optional" ? rustOptionElementCarrier(read.resultCarrier) : read.resultCarrier;
    const projected = fieldCarrier === undefined ? undefined
      : selectRustSourceValueConversion(fieldCarrier, rustJsValueTargetType(), context.typeDefinitions);
    const contract = projected === undefined ? undefined : rustValueConversionContract(projected, context.typeDefinitions);
    if (fieldCarrier === undefined || projected === undefined || projected.kind === "option-map" || projected.kind === "option-some" ||
      contract === undefined || contract.fallible) return undefined;
    fields.push(Object.freeze({ sourceName: pair.destination.property.name, sourceCarrier: fieldCarrier, presence, conversion: projected }));
    reads.push(read.kind === "source-field"
      ? Object.freeze({ ...read, valueSemantics: Object.freeze(read.valueSemantics),
          ...(read.dispatch === undefined ? {} : { dispatch: Object.freeze(read.dispatch) }) })
      : Object.freeze({ ...read, receiver: Object.freeze(read.receiver),
          ...(read.read === undefined ? {} : { read: Object.freeze(read.read) }),
          ...(read.dispatch === undefined ? {} : { dispatch: Object.freeze(read.dispatch) }) }));
  }
  if (new Set(fields.map(field => field.sourceName)).size !== fields.length) return undefined;
  const conversion = Object.freeze({ kind: "js-value-from-properties" as const, source, fields: Object.freeze(fields) });
  return Object.freeze({ source, conversion, reads: Object.freeze(reads) });
}

export function rustPropertyProjectionGetters(
  expression: Node,
  context: Pick<RustOperationAnalysisContext, "records" | "ast"> & {
    readonly projectTypes: RustProjectTypePolicy;
    readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  },
): readonly Node[] {
  const getters = context.records.propertyProjection.get(expression)?.cases.flatMap(projection =>
    projection.reads.flatMap(read => {
      if (read.kind === "source-accessor") return read.read === undefined ? [] : [read.read.declaration];
      if (read.declaration === undefined) return [];
      if (context.ast.is.IsGetAccessorDeclaration(read.declaration)) return [read.declaration];
      if (read.dispatch === undefined) return [];
      const owner = context.projectTypes.definitionContainingDeclaration(read.declaration);
      return owner === undefined ? [] : context.projectTypes.concreteClassesFor(owner).flatMap(concrete => {
        const implementation = context.projectFieldDispatch.implementationFor(concrete, read.declaration!);
        return implementation?.kind === "accessor" ? [implementation.getter] : [];
      });
    })) ?? [];
  return [...new Set(getters)];
}
