import type { Node, SourceFile } from "@tsonic/tsts";

import type { TargetTypeRef } from "../../../../target-model/types/model.js";

import { closedMetadataKey, closedMetadataEquals, snapshotClosedMetadata } from "../../../../target-model/metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustPascalCaseIdentifier, rustScreamingSnakeIdentifier, rustSnakeCaseIdentifier } from "../../../../target-model/names/identifiers.js";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import type { RustClassEnvironment } from "../../../../target-model/records/objects/class-values.js";

import type { RustAnalysisContext } from "../../context.js";

import type { RustClassValueCallable } from "../../../../target-model/records/callables/class-value-callables.js";

import type { RustProjectStructuralView } from "../../../../target-model/records/objects/project-structural-views.js";
import { selectRustProjectViewImplementations } from "../../../objects/view-implementations.js";

import type { RustCallableValueAdapter } from "../../../../target-model/records/callables/callable-adapters.js";
import { rustCallableAdapterValues } from "../../../../policy/conversions/callable-values.js";

import type { RustClassValuePlan, RustClassValueView, RustClassValueDefinition } from "../../../../target-model/records/objects/class-values.js";
export interface RustClassValueRegistry {
  instanceViewRequests(): readonly RustProjectStructuralView[];
  valueAdapters(): readonly { readonly subject: Node; readonly adapter: RustCallableValueAdapter }[];
  recordInstanceView(view: RustProjectStructuralView): boolean;
  hasConstructorValue(declaration: Node): boolean;
  hasConstructorView(declaration: Node): boolean;
  evaluatesConstructorValue(declaration: Node): boolean;
  recordConstructorValue(declaration: Node, demand: "type" | "value"): void;
  record(view: RustClassValueView): boolean;
  recordEnvironment(environment: RustClassEnvironment): boolean;
  seal(context: RustAnalysisContext): RustClassValuePlan;
}

export function createRustClassValueRegistry(): RustClassValueRegistry {
  const requests = new Map<Node, Map<string, RustClassValueView>>();
  const environments = new Map<Node, RustClassEnvironment>();
  const constructors = new Set<Node>();
  const evaluatedConstructors = new Set<Node>();
  const instanceViews: RustProjectStructuralView[] = [];
  let sealed = false;
  return {
    instanceViewRequests() { return Object.freeze([...instanceViews]); },
    valueAdapters() {
      const result: { readonly subject: Node; readonly adapter: RustCallableValueAdapter }[] = [];
      const record = (callable: RustClassValueCallable): void => {
        for (const adapter of rustCallableAdapterValues(callable)) result.push(Object.freeze({ subject: callable.declaration, adapter }));
      };
      for (const view of instanceViews) {
        for (const field of view.fields) {
          if (field.readAdapter !== undefined) result.push(Object.freeze({ subject: field.declaration, adapter: field.readAdapter }));
          if (field.callable !== undefined) record(field.callable);
        }
      }
      for (const views of requests.values()) {
        for (const view of views.values()) {
          if (view.construction !== undefined) record(view.construction);
          for (const field of view.fields) if (field.callable !== undefined) record(field.callable);
        }
      }
      return Object.freeze(result);
    },
    recordInstanceView(view) {
      if (sealed) throw new Error("Rust instance views cannot change after sealing.");
      const existing = instanceViews.find(candidate => candidate.declaration === view.declaration &&
        rustTargetTypeRefEquals(candidate.sourceCarrier, view.sourceCarrier) && rustTargetTypeRefEquals(candidate.targetCarrier, view.targetCarrier));
      if (existing !== undefined) return existing.fields.length === view.fields.length && existing.fields.every((field, index) =>
        field.declaration === view.fields[index]?.declaration && field.storageIndex === view.fields[index]?.storageIndex &&
        instanceViewFieldsEqual(field.field, view.fields[index]?.field) &&
        instanceViewAccessorsEqual(field.accessor, view.fields[index]?.accessor) &&
        closedMetadataEquals(field.readAdapter, view.fields[index]?.readAdapter) &&
        classValueCallablesEqual(field.callable, view.fields[index]?.callable));
      instanceViews.push(Object.freeze({ ...view,
        fields: Object.freeze(view.fields.map(field => Object.freeze({ ...field }))) }));
      return true;
    },
    hasConstructorValue(declaration) {
      return constructors.has(declaration) || (requests.get(declaration)?.size ?? 0) > 0;
    },
    hasConstructorView(declaration) {
      return (requests.get(declaration)?.size ?? 0) > 0;
    },
    evaluatesConstructorValue(declaration) {
      return evaluatedConstructors.has(declaration) || (requests.get(declaration)?.size ?? 0) > 0;
    },
    recordConstructorValue(declaration, demand) {
      if (sealed) throw new Error("Rust constructor values cannot change after sealing.");
      constructors.add(declaration);
      if (demand === "value") evaluatedConstructors.add(declaration);
    },
    recordEnvironment(environment) {
      if (sealed) throw new Error("Rust class environments cannot change after sealing.");
      if (environment.storage !== "value" && environment.storage !== "shared") return false;
      const previous = environments.get(environment.declaration);
      if (previous !== undefined) return classEnvironmentsEqual(previous, environment);
      const names = [...environment.captures, ...environment.staticFields].map(field => field.fieldName);
      if (new Set(names).size !== names.length || names.some(name => name.length === 0) ||
        ![environment.carrier, ...environment.captures.map(capture => capture.carrier),
          ...environment.staticFields.map(field => field.carrier)].every(isRustTargetTypeRef)) return false;
      environments.set(environment.declaration, Object.freeze({ ...environment, carrier: snapshotClosedMetadata(environment.carrier),
        genericParameterIndexes: Object.freeze([...environment.genericParameterIndexes]),
        consumers: Object.freeze([...environment.consumers]),
        captures: Object.freeze(environment.captures.map(capture => Object.freeze({ ...capture, carrier: snapshotClosedMetadata(capture.carrier) }))),
        staticFields: Object.freeze(environment.staticFields.map(field => Object.freeze({ ...field, carrier: snapshotClosedMetadata(field.carrier) }))),
      }));
      return true;
    },
    record(view) {
      if (sealed) throw new Error("Rust constructor views cannot change after sealing.");
      const views = requests.get(view.declaration) ?? new Map<string, RustClassValueView>();
      const key = closedMetadataKey([view.sourceCarrier, view.targetCarrier]);
      const existing = views.get(key);
      if (existing !== undefined) return existing.fields.length === view.fields.length &&
        classValueCallablesEqual(existing.construction, view.construction) &&
        existing.fields.every((field, index) => field.declaration === view.fields[index]?.declaration &&
          field.storageIndex === view.fields[index]?.storageIndex && field.writable === view.fields[index]?.writable &&
          classValueCallablesEqual(field.callable, view.fields[index]?.callable));
      views.set(key, Object.freeze({ ...view, sourceCarrier: snapshotClosedMetadata(view.sourceCarrier), targetCarrier: snapshotClosedMetadata(view.targetCarrier),
        fields: Object.freeze(view.fields.map(field => Object.freeze({ ...field }))) }));
      requests.set(view.declaration, views);
      return true;
    },
    seal(context) {
      if (sealed) throw new Error("Rust constructor views can be sealed only once.");
      sealed = true;
      const byDeclaration = new Map<Node, RustClassValueDefinition>();
      const namesByFile = new Map<SourceFile, Set<string>>();
      const { ast } = context;
      const projectNamesByFile = new Map<SourceFile, Set<string>>();
      for (const definition of context.projectTypes.definitions) {
        const names = projectNamesByFile.get(definition.sourceFile) ?? new Set<string>();
        names.add(definition.stateName);
        names.add(definition.dispatchName);
        if (definition.rootName !== undefined) names.add(definition.rootName);
        projectNamesByFile.set(definition.sourceFile, names);
      }
      const allocate = (declaration: Node, purpose: string, style: "constant" | "callable" | "type" = "constant"): string => {
        const file = ast.getSourceFile(declaration);
        if (file === undefined) throw new Error("Finalized constructor view has no exact source file.");
        let names = namesByFile.get(file);
        if (names === undefined) {
          names = new Set(projectNamesByFile.get(file));
          const collect = (node: Node): void => {
            if (!context.isNativeNode(node)) return;
            const name = context.names.nameForDeclaration(node);
            if (name !== undefined) names!.add(name);
            const slot = context.projectTypes.memberSlotName(node, "static");
            if (slot !== undefined) names!.add(slot);
            ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
          };
          collect(file);
          namesByFile.set(file, names);
        }
        const identifier = style === "callable" ? rustSnakeCaseIdentifier
          : style === "type" ? rustPascalCaseIdentifier : rustScreamingSnakeIdentifier;
        const base = identifier(`${context.names.nameForDeclaration(declaration)}_${purpose}`);
        let selected = base;
        let suffix = 2;
        while (names.has(selected)) selected = `${base}_${suffix++}`;
        names.add(selected);
        return selected;
      };
      for (const declaration of new Set([...requests.keys(), ...environments.keys()])) {
        const views = [...(requests.get(declaration)?.entries() ?? [])].sort(([left], [right]) => left.localeCompare(right))
          .map(([, view]) => view);
        const environment = environments.get(declaration);
        const definition = context.projectTypes.definitionForDeclaration(declaration);
        const fields = new Set<string>();
        if (environment !== undefined) {
          if (definition === undefined) throw new Error("Class environment has no exact native class definition.");
          fields.add(context.projectTypes.baseStateFieldName(definition));
          fields.add(context.projectTypes.stateMarkerFieldName(definition));
          for (const member of ast.members(declaration)) {
            if (member === undefined) throw new Error("Class environment has an absent source member.");
            const field = context.projectTypes.fieldStorageName(definition, member);
            if (field !== undefined) fields.add(field);
          }
        }
        byDeclaration.set(declaration, Object.freeze({
          declaration, views: Object.freeze(views),
          ...(environment === undefined ? {} : { environment: Object.freeze({ ...environment,
            typeName: allocate(declaration, "Class", "type"),
            instanceFieldName: allocateRustGeneratedName(fields, "class_environment"),
            bindingName: allocate(declaration, "class_environment",
              ast.parent(declaration) === ast.getSourceFile(declaration) ? "constant" : "callable"),
            parameterName: allocate(declaration, "class_context", "callable"),
            identityFieldName: allocateRustGeneratedName(new Set([...fields,
              ...environment.captures.map(field => field.fieldName), ...environment.staticFields.map(field => field.fieldName)]), "class_identity"),
          }) }),
        }));
      }
      return Object.freeze({
        constructorViewImplementations: selectRustProjectViewImplementations([...byDeclaration.values()].flatMap(definition => definition.views), context),
        instanceViews: Object.freeze([...instanceViews]),
        instanceViewImplementations: selectRustProjectViewImplementations(instanceViews, context),
        forDeclaration: (declaration: Node) => byDeclaration.get(declaration),
        viewFor(declaration: Node, sourceCarrier: TargetTypeRef, carrier: TargetTypeRef) {
          return byDeclaration.get(declaration)?.views.find(view => rustTargetTypeRefEquals(view.sourceCarrier, sourceCarrier) && rustTargetTypeRefEquals(view.targetCarrier, carrier));
        },
      });
    },
  };
}

function instanceViewFieldsEqual(
  left: RustProjectStructuralView["fields"][number]["field"],
  right: RustProjectStructuralView["fields"][number]["field"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const { declaration: leftDeclaration, ...leftContract } = left;
  const { declaration: rightDeclaration, ...rightContract } = right;
  return leftDeclaration === rightDeclaration && closedMetadataEquals(leftContract, rightContract);
}

function instanceViewAccessorsEqual(
  left: RustProjectStructuralView["fields"][number]["accessor"],
  right: RustProjectStructuralView["fields"][number]["accessor"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.read?.declaration === right.read?.declaration && left.read?.method === right.read?.method &&
    left.write?.declaration === right.write?.declaration && left.write?.method === right.write?.method &&
    rustTargetTypeRefEquals(left.read?.resultCarrier, right.read?.resultCarrier) &&
    rustTargetTypeRefEquals(left.write?.valueCarrier, right.write?.valueCarrier) &&
    rustTargetTypeRefEquals(left.dispatch?.ownerCarrier, right.dispatch?.ownerCarrier) &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) && closedMetadataEquals(left.receiver, right.receiver);
}

function classValueCallablesEqual(left: RustClassValueCallable | undefined, right: RustClassValueCallable | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  const { declaration: leftDeclaration, ...leftContract } = left;
  const { declaration: rightDeclaration, ...rightContract } = right;
  return leftDeclaration === rightDeclaration && closedMetadataEquals(leftContract, rightContract);
}

function classEnvironmentsEqual(left: RustClassEnvironment, right: RustClassEnvironment): boolean {
  return left.storage === right.storage && left.copy === right.copy && left.constructorValue === right.constructorValue &&
    left.constructorIdentity === right.constructorIdentity &&
    left.evaluatedConstructorValue === right.evaluatedConstructorValue &&
    closedMetadataEquals(left.genericParameterIndexes, right.genericParameterIndexes) &&
    left.initializationUsesEnvironment === right.initializationUsesEnvironment &&
    left.instancesUseEnvironment === right.instancesUseEnvironment &&
    left.consumers.length === right.consumers.length && left.consumers.every((consumer, index) => consumer === right.consumers[index]) &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.captures.length === right.captures.length && left.staticFields.length === right.staticFields.length &&
    left.captures.every((capture, index) => {
      const other = right.captures[index]!;
      return capture.declaration === other.declaration && capture.reference === other.reference &&
        capture.storage === other.storage && capture.fieldName === other.fieldName &&
        rustTargetTypeRefEquals(capture.carrier, other.carrier);
    }) && left.staticFields.every((field, index) => {
      const other = right.staticFields[index]!;
      return field.declaration === other.declaration && field.fieldName === other.fieldName &&
        field.readonly === other.readonly && rustTargetTypeRefEquals(field.carrier, other.carrier);
    });
}
