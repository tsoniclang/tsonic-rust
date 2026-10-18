import type { Node } from "@tsonic/tsts";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustCallableParameterAdapter, RustCallableValueAdapter } from "../../target-model/records/callable-adapters.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "./generic-bindings.js";
import type { RustCallableEmissionPreparationInput, RustEmissionContextRequest } from "./emission-contexts.js";
import type { RustClassValueCallable } from "../objects/class-value-callables.js";
import type { RustClassValuePlan } from "../objects/class-values.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";

type AdapterInput = RustEmissionContextRequest["callableAdapterInputs"][number];

export type RustHelperCallableEmissionRequest = Pick<RustEmissionContextRequest,
  "declaration" | "nativeOwnerFileName" | "bindings" | "sourceCarriers" | "callableAdapterInputs"> & {
  readonly subject: object;
  readonly identity: string;
  readonly returnCarrier: TargetTypeRef;
};

export function prepareRustHelperCallableEmissionRequests(
  input: Pick<RustCallableEmissionPreparationInput, "ast" | "records" | "projectMethodDispatch" | "isNativeNode"> & {
    readonly nativeNodes: readonly Node[];
    readonly classValues: RustClassValuePlan;
    readonly projectTypes: Pick<RustProjectTypePolicy, "definitions" | "definitionForCarrier">;
  },
  declaredBindings: (declaration: Node) => RustTargetGenericBindings | undefined,
): TargetStageResult<readonly RustHelperCallableEmissionRequest[]> {
  const diagnostics: TargetDiagnostic[] = [];
  const requests: RustHelperCallableEmissionRequest[] = [];
  const append = (request: RustHelperCallableEmissionRequest): void => {
    requests.push(Object.freeze({ ...request, sourceCarriers: Object.freeze([...request.sourceCarriers]) }));
  };
  const reject = (node: Node, message: string): void => {
    diagnostics.push({ code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
      sourceNode: node, message, evidence: ["rust.callable-value.physical-emission-context"] });
  };
  const identityFor = (node: Node, suffix: string): string | undefined => {
    const identity = sourceNodeIdentity(input.ast, node);
    const file = input.ast.getSourceFile(node);
    if (identity === undefined || file === undefined) {
      reject(node, "A generated helper requires its original checked declaration identity.");
      return undefined;
    }
    return `${input.ast.getFileName(file)}:${identity}:${suffix}`;
  };
  const collect = (node: Node, adapter: RustCallableValueAdapter, origin: AdapterInput["origin"], selected: AdapterInput[]): void => {
    if (adapter.kind === "option-map" || adapter.kind === "option-some") collect(node, adapter.element, origin, selected);
    else if (adapter.kind === "conversion" && adapter.conversion.kind === "callable-adapter")
      selected.push(Object.freeze({ node, selection: adapter.conversion, origin }));
  };
  const adaptersFor = (node: Node, parameters: readonly RustCallableParameterAdapter[], result: RustCallableValueAdapter,
    resultOrigin: AdapterInput["origin"]): readonly AdapterInput[] => {
    const selected: AdapterInput[] = [];
    for (const parameter of parameters) {
      if (parameter.kind === "omitted") continue;
      if (parameter.kind === "rest") {
        for (const segment of parameter.segments) collect(node, segment.adapter,
          Object.freeze({ kind: "parameter", abi: segment.source }), selected);
      } else collect(node, parameter.adapter, Object.freeze({ kind: "parameter", abi: parameter.source }), selected);
    }
    collect(node, result, resultOrigin, selected);
    return Object.freeze(selected);
  };
  const ownerBindings = (declaration: Node, carrier: TargetTypeRef): RustTargetGenericBindings | undefined => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    const actual = rustSourceTypeCarrierValue(carrier);
    const lexical = declaredBindings(declaration);
    if (definition === undefined || actual === undefined || lexical === undefined) return undefined;
    const parameters: RustTargetGenericArgument[] = definition.genericParameters.map(parameter => parameter.kind === "lifetime"
      ? { kind: "lifetime", lifetime: parameter.lifetime }
      : { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } });
    const selected = rustGenericCallablePhysicalBindings(parameters, actual.genericArguments);
    return selected === undefined ? undefined : snapshotRustCallableBindings({
      types: new Map([...lexical.types, ...selected.types]), lifetimes: new Map([...lexical.lifetimes, ...selected.lifetimes]),
      consts: new Map([...lexical.consts, ...selected.consts]),
    });
  };
  const classCallable = (callable: RustClassValueCallable, nativeOwnerFileName: string, suffix: string): void => {
    const bindings = ownerBindings(callable.declaration, callable.ownerCarrier);
    const identity = identityFor(callable.declaration, suffix);
    if (bindings === undefined || identity === undefined) {
      reject(callable.declaration, "A generated class callable requires its actual selected owner and complete generic bindings.");
      return;
    }
    append({ subject: callable, declaration: callable.declaration, identity, nativeOwnerFileName, bindings,
      sourceCarriers: [callable.ownerCarrier, callable.carrier, ...callable.parameters.map(parameter => parameter.parameterCarrier)],
      returnCarrier: callable.resultAdapter.targetCarrier, callableAdapterInputs: adaptersFor(callable.declaration,
        callable.parameterAdapters, callable.resultAdapter, Object.freeze({ kind: "return", declaration: callable.declaration })) });
  };
  for (const concrete of input.projectTypes.definitions) {
    if (!input.isNativeNode(concrete.declaration)) continue;
    for (const adapter of input.records.projectCallableAdapters.get(concrete.declaration) ?? []) {
      const variants = input.projectMethodDispatch.variantsForMember(adapter.contract).filter(variant =>
        variant.virtualSlot === adapter.slot || variant.exactSlot === adapter.slot);
      if (variants.length > 1) {
        reject(adapter.contract, "A generated dispatch adapter requires its single original selected method variant.");
        continue;
      }
      const body = input.projectMethodDispatch.bodyFor(concrete, adapter.implementation, variants[0]);
      const lexical = declaredBindings(adapter.contract);
      const identity = identityFor(adapter.contract, `${concrete.targetPath}:${adapter.slot}`);
      if (body === undefined || lexical === undefined || identity === undefined) {
        reject(adapter.contract, "A generated dispatch adapter requires its exact concrete body and contract bindings.");
        continue;
      }
      const bindings = snapshotRustCallableBindings({
        types: new Map([...lexical.types, ...body.bindings.types, ...body.contractBindings.types]),
        lifetimes: new Map([...lexical.lifetimes, ...body.bindings.lifetimes, ...body.contractBindings.lifetimes]),
        consts: new Map([...lexical.consts, ...body.bindings.consts, ...body.contractBindings.consts]),
      });
      append({ subject: adapter, declaration: adapter.contract, identity, nativeOwnerFileName: concrete.fileName, bindings,
        sourceCarriers: [...adapter.parameters.map(parameter => parameter.parameterCarrier), adapter.returnCarrier,
          ...adapter.implementationParameters.map(parameter => parameter.parameterCarrier), adapter.implementationReturnCarrier],
        returnCarrier: adapter.returnCarrier, callableAdapterInputs: adaptersFor(adapter.contract, adapter.parameterAdapters,
          adapter.resultAdapter, Object.freeze({ kind: "return", declaration: adapter.implementation })) });
    }
  }
  for (const node of input.nativeNodes) {
    const fact = input.records.objectLiteralMethodAdapter.get(node);
    if (fact !== undefined) for (const dispatch of fact.dispatches) {
      const implementation = fact.implementations[dispatch.implementationIndex];
      const lexical = implementation === undefined ? undefined : declaredBindings(implementation.sourceCallable);
      const identity = identityFor(node, dispatch.virtualSlot);
      const sourceFile = input.ast.getSourceFile(node);
      if (implementation === undefined || lexical === undefined || identity === undefined || sourceFile === undefined) {
        reject(node, "A generated object dispatch requires its original implementation, slot and source owner.");
        continue;
      }
      const bindings = snapshotRustCallableBindings({ types: new Map([...lexical.types, ...implementation.typeParameterSubstitutions]),
        lifetimes: lexical.lifetimes, consts: lexical.consts });
      append({ subject: dispatch, declaration: dispatch.contractMethod, identity,
        nativeOwnerFileName: input.ast.getFileName(sourceFile), bindings,
        sourceCarriers: [...dispatch.parameters.map(parameter => parameter.parameterCarrier), dispatch.returnCarrier,
          ...implementation.parameters.map(parameter => parameter.parameterCarrier), implementation.returnCarrier],
        returnCarrier: dispatch.returnCarrier, callableAdapterInputs: adaptersFor(dispatch.contractMethod, dispatch.parameterAdapters,
          dispatch.resultAdapter, Object.freeze({ kind: "return", declaration: implementation.sourceCallable })) });
    }
  }
  for (const view of input.classValues.constructorViewImplementations) {
    const suffix = closedMetadataKey([view.sourceCarrier, view.targetCarrier]);
    if (view.construction !== undefined) classCallable(view.construction, view.ownerFileName, `${suffix}:constructor`);
    for (const field of view.fields) if (field.callable !== undefined)
      classCallable(field.callable, view.ownerFileName, `${suffix}:field:${field.storageIndex}`);
  }
  for (const view of input.classValues.instanceViewImplementations) {
    const suffix = closedMetadataKey([view.sourceCarrier, view.targetCarrier]);
    for (const field of view.fields) {
      if (field.callable !== undefined) {
        classCallable(field.callable, view.ownerFileName, `${suffix}:field:${field.storageIndex}`);
        continue;
      }
      const bindings = ownerBindings(field.declaration, view.sourceCarrier);
      const identity = identityFor(field.declaration, `${suffix}:field:${field.storageIndex}`);
      const selected: AdapterInput[] = [];
      if (field.readAdapter !== undefined) {
        if (field.accessor?.read !== undefined) collect(field.declaration, field.readAdapter,
          Object.freeze({ kind: "return", declaration: field.accessor.read.declaration }), selected);
        else if (field.field !== undefined) collect(field.declaration, field.readAdapter,
          Object.freeze({ kind: "field", selection: field.field }), selected);
        else reject(field.declaration, "A generated structural read requires its exact original selected field or accessor.");
      }
      if (bindings === undefined || identity === undefined || field.readAdapter === undefined) {
        reject(field.declaration, "A generated structural read requires its actual owner, bindings and result ABI.");
        continue;
      }
      append({ subject: field, declaration: field.declaration, identity, nativeOwnerFileName: view.ownerFileName, bindings,
        sourceCarriers: [view.sourceCarrier, view.targetCarrier, field.readAdapter.sourceCarrier, field.readAdapter.targetCarrier],
        returnCarrier: field.readAdapter.targetCarrier, callableAdapterInputs: Object.freeze(selected) });
    }
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(requests)) : rejectedTargetStage(diagnostics);
}
