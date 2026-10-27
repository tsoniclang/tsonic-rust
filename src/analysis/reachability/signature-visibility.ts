import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageEmissionProducer } from "../program/records/program/source-packages.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustSourceTypeCarrierValue, rustSourceUnionCarrierValue } from "../../target-model/types/index.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustNativeErrorJoinReference } from "../../target-model/types/native-error-joins.js";

export function analyzeRustSignatureVisibility(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustSourcePackageEmissionProducer): void {
  const components = program.records.sourcePackageComponents.get();
  if (components === undefined) failTargetAnalysisInvariant("tsonic-rust", "Native signature closure requires its exact source components.");
  const required = new Map<string, Map<string, Set<string>>>();
  const pending: TargetTypeRef[] = [program.errorRegions.initialization.binary.lifecycle.carrier];
  const processed = new Set<string>();
  const expanded = new Set<Node>();
  const declarations = new Map<string, Node>();
  const expose = (fileName: string, name: string): void => {
    const identity = program.sourceOutputIdentities.get(fileName);
    if (identity === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted public native signature requires its owning source module.");
    const modules = required.get(identity.componentId)!;
    const selected = modules.get(identity.moduleName) ?? new Set<string>();
    selected.add(name);
    modules.set(identity.moduleName, selected);
    const declaration = declarations.get(closedMetadataKey([fileName, name]));
    if (declaration !== undefined) expand(declaration);
  };
  for (const component of components) required.set(component.componentId, new Map());
  for (const node of nodes) {
    const form = program.records.nativeDeclaration.get(node);
    if (form === undefined) continue;
    const file = program.source.ast.getSourceFile(node);
    if (file !== undefined) declarations.set(closedMetadataKey([program.source.ast.getFileName(file), form.name]), node);
  }
  for (const node of nodes) {
    const task = program.records.nativeTaskUse.get(node);
    if (task !== undefined) pending.push(task.scope.carrier, task.scope.errorCarrier,
      ...(task.kind === "owner" || task.kind === "entry" ? [task.inputCarrier] : []),
      ...(task.kind === "entry" && task.initializer !== undefined ? [task.initializer.inputCarrier] : []));
    const declaration = program.records.nativeDeclaration.get(node);
    if (declaration !== undefined && program.records.declarationLiveness.get(node)?.visibility === "public") {
      const file = program.source.ast.getSourceFile(node);
      if (file !== undefined) expose(program.source.ast.getFileName(file), declaration.name);
    }
    const nativeClass = program.records.nativeClass.get(node);
    if (nativeClass?.visibility === "public") pending.push(nativeClass.carrier);
    const callable = program.records.callableDeclaration.get(node);
    if (callable?.visibility === "public") pending.push(...callable.parameterCarriers, callable.resultCarrier);
    const binding = program.records.moduleBinding.get(node);
    const bindingEmission = program.records.moduleBindingEmission.get(node);
    if (binding !== undefined && bindingEmission?.visibility === "public") {
      if (binding.storage === "native-callable") {
        if (binding.value !== undefined) pending.push(binding.value.carrier, ...binding.value.parameterCarriers, binding.value.resultCarrier);
      } else pending.push(binding.valueCarrier);
    }
    const exported = program.records.defaultExport.get(node);
    if (exported !== undefined) pending.push(exported.carrier);
  }
  for (const component of components) {
    for (const variant of program.records.programErrorVariants.get(component.componentId) ?? [])
      if (variant.kind === "project") pending.push(program.projectTypes.openCarrier(variant.definition));
      else if (variant.kind === "closed") pending.push(variant.carrier);
  }
  for (const definition of program.callableValues.generic.physical.definitions()) pending.push(definition.carrier,
    ...definition.signature.parameters, definition.signature.result, ...definition.members.flatMap(member =>
      [...member.environment.captures, ...member.environment.receiverFields, ...member.environment.receivers].map(capture => capture.storageCarrier)));
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (processed.has(key)) continue;
    processed.add(key);
    pending.push(...rustTargetTypeChildren(carrier));
    const errorJoin = rustNativeErrorJoinReference(carrier);
    if (errorJoin !== undefined) {
      const declaration = program.errorRegions.declarationsFor(errorJoin.fileName).find(value => value.arity === errorJoin.errors.length);
      if (declaration === undefined) failTargetAnalysisInvariant("tsonic-rust", "A public native error join requires its single sealed declaration.");
      expose(errorJoin.fileName, declaration.name);
    }
    const definition = program.projectTypes.definitionForCarrier(carrier);
    if (definition !== undefined) {
      expose(definition.fileName, definition.targetName);
      const native = program.records.nativeClass.get(definition.declaration);
      if (native !== undefined) {
        pending.push(...native.fields.filter(field => field.visibility === "public").map(field => field.carrier));
        for (const member of [...native.methods, ...native.accessors.map(accessor => accessor.declaration)]) {
          const signature = program.records.callableDeclaration.get(member);
          if (signature?.visibility === "public") pending.push(...signature.parameterCarriers, signature.resultCarrier);
        }
      } else expand(definition.declaration);
    }
    const source = rustSourceTypeCarrierValue(carrier);
    if (source !== undefined) expose(source.fileName, source.typeName);
    const union = rustSourceUnionCarrierValue(carrier);
    if (union !== undefined) {
      if (union.origin === "generated") {
        const selected = program.structuralShapes.unionForCarrier(carrier);
        if (selected !== undefined) exposeShape(selected.componentId, selected.targetName);
      } else expose(union.fileName, union.typeName);
      pending.push(...program.typeDefinitions.sourceUnionVariants(carrier)?.map(variant => variant.carrier) ?? []);
    }
    const shape = program.structuralShapes.definitionForCarrier(carrier);
    if (shape !== undefined) {
      exposeShape(shape.componentId, shape.targetName);
      if (shape.dispatchName !== undefined) exposeShape(shape.componentId, shape.dispatchName);
      const selection = program.records.structuralShapeEmission.get(shape);
      if (selection === undefined) failTargetAnalysisInvariant("tsonic-rust", "A public native structural signature requires its selected physical layout.");
      pending.push(...selection.bases, ...selection.fields.flatMap(field => [field.carrier,
        ...(field.property === undefined ? [] : [field.property.stored, field.property.getter,
          ...(field.property.setter === undefined ? [] : [field.property.setter])])]),
        ...(selection.dispatch?.members.flatMap(member => [...member.parameters, member.result]) ?? []));
    }
    const generic = rustGenericCallableValue(carrier);
    if (generic !== undefined) pending.push(...generic.environment, ...generic.signature.parameters, generic.signature.result);
  }
  for (const component of components) {
    const modules = required.get(component.componentId)!;
    producer.visibility(component.componentId, { requiredByModule: modules,
      structuralShapes: modules.get(component.structuralShapesModuleName) ?? new Set<string>() });
  }

  function exposeShape(componentId: string, name: string): void {
    const component = components!.find(selected => selected.componentId === componentId);
    const modules = required.get(componentId);
    if (component === undefined || modules === undefined) failTargetAnalysisInvariant("tsonic-rust", "A public native shape requires its owning source component.");
    const selected = modules.get(component.structuralShapesModuleName) ?? new Set<string>();
    selected.add(name);
    modules.set(component.structuralShapesModuleName, selected);
  }

  function expand(node: Node): void {
    if (expanded.has(node)) return;
    expanded.add(node);
    const form = program.records.nativeDeclaration.get(node);
    if (form?.kind === "interface") pending.push(...form.fields.map(field => field.carrier),
      ...(form.index === undefined ? [] : [form.index.keyCarrier, form.index.valueCarrier]));
    else if (form?.kind === "alias") {
      if (form.fact.kind === "native-alias") pending.push(form.fact.target);
      else if (form.fact.kind === "runtime") pending.push(...form.fact.variants.map(variant => variant.carrier));
    }
  }
}
