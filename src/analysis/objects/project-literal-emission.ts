import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectLiteralEmission, RustProjectLiteralImplementation, RustProjectLiteralMethodEmission, RustRecordLiteralFact } from "../../target-model/records/objects/object-literal-emission.js";
import { rustCallableProtocol, rustProgramErrorTargetType, substituteRustTargetTypeParameters } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { selectRustPhysicalProgramErrorOwner } from "../errors/error-types.js";
import { sourceCallableParameterAbis, sourceCallableReturnCarrier, projectOwnerTypeSubstitutions } from "../callables/native/adapters.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function analyzeRustProjectLiteralEmission(program: Omit<RustAnalysisProgram, "reachability">,
  node: Node, fact: RustRecordLiteralFact, source: TargetSourceProgram): RustProjectLiteralEmission {
  const definition = program.projectTypes.definitionForCarrier(fact.resultCarrier);
  const contracts = program.records.projectInstanceContracts.get(fact.resultCarrier);
  if (definition?.kind !== "interface" || contracts === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "An admitted project literal requires its exact native interface and instantiated contracts.", node);
  const input = { ast: program.source.ast, source, records: program.records, sourceLifetimes: program.sourceLifetimes };
  const errorFor = (declaration: Node): TargetTypeRef => {
    const owner = selectRustPhysicalProgramErrorOwner(declaration, { ast: input.ast, components: program.sourcePackageComponents });
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted literal callable requires its exact declaration-owned native error carrier.", declaration);
    return rustProgramErrorTargetType(owner);
  };
  const roles = new Map<number, Set<"get" | "set">>();
  for (const contribution of fact.contributions) if (contribution.kind === "accessor") {
    const selected = roles.get(contribution.targetStorageIndex) ?? new Set();
    selected.add(contribution.role);
    roles.set(contribution.targetStorageIndex, selected);
  }
  const fields: RustProjectLiteralEmission["fields"][number][] = [];
  const accessors: RustProjectLiteralEmission["accessors"][number][] = [];
  for (const field of fact.fields) {
    const selected = roles.get(field.storageIndex);
    if (selected === undefined) {
      const declaration = field.implementationDeclaration;
      const owner = declaration === undefined ? undefined : program.projectTypes.definitionContainingDeclaration(declaration);
      const preferredName = owner === undefined || declaration === undefined ? undefined : program.projectTypes.fieldStorageName(owner, declaration);
      const ownerCarrier = owner === undefined ? undefined : program.records.projectRelationship.get(fact.resultCarrier, owner);
      const physical = owner === undefined || ownerCarrier === undefined ? undefined
        : program.records.projectClassFields.get(owner, ownerCarrier)?.find(candidate => candidate.declaration === declaration);
      if (declaration === undefined || preferredName === undefined || physical === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted literal field requires its exact instantiated physical native storage identity.", node);
      fields.push(Object.freeze({ declaration, contracts: field.contractDeclarations, storageIndex: field.storageIndex, preferredName, carrier: physical.carrier }));
    } else {
      const first = field.contractDeclarations[0];
      if (first === undefined || !selected.has("get") || selected.has("set") !== !field.readonly)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted literal accessor requires its exact getter and setter correspondence.", node);
      const error = errorFor(first);
      for (const declaration of field.contractDeclarations) {
        const dispatch = program.projectFieldDispatch.planFor(declaration);
        if (dispatch === undefined || !dispatch.read.fallible || !field.readonly && dispatch.write?.fallible !== true ||
          !rustTargetTypeRefEquals(program.records.projectMemberError.get(declaration)?.carrier, error))
          failTargetAnalysisInvariant("tsonic-rust", "An admitted literal accessor requires its exact contract-owned native effects and error carrier.", declaration);
      }
      accessors.push(Object.freeze({ storageIndex: field.storageIndex, contracts: field.contractDeclarations, carrier: field.carrier, error, setter: selected.has("set") }));
    }
  }
  const adapter = program.records.objectLiteralMethodAdapter.get(node);
  if (fact.contributions.some(contribution => contribution.kind === "method") && adapter === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "An admitted authored literal method requires its exact selected callable adapter.", node);
  const implementations: RustProjectLiteralImplementation[] = (adapter?.implementations ?? []).map(implementation => Object.freeze({
    kind: "authored", propertyIdentity: implementation.sourceCallable, sourceCallable: implementation.sourceCallable,
    parameters: Object.freeze(implementation.parameters.map(parameter => parameter.parameterCarrier)), result: implementation.returnCarrier,
    error: program.records.fallible.get(implementation.sourceCallable) === undefined ? undefined : errorFor(implementation.sourceCallable),
    substitutions: implementation.typeParameterSubstitutions }));
  const final = new Map<Node, RustRecordLiteralFact["contributions"][number]>();
  for (const contribution of fact.contributions) {
    if (contribution.kind === "method") for (const declaration of contribution.contractDeclarations) final.set(declaration, contribution);
    else if (contribution.kind === "spread") for (const method of contribution.methods) final.set(method.contractDeclaration, contribution);
  }
  const methods: RustProjectLiteralMethodEmission[] = [];
  const overrides: number[] = [];
  const overrideByIdentity = new Map<Node, { readonly index: number; readonly signature: unknown }>();
  const append = (contractMethod: Node, variant: RustProjectLiteralMethodEmission["variant"], implementationIndex: number,
    selectedAdapter: RustProjectLiteralMethodEmission["adapter"]): void => {
    const owner = program.projectTypes.definitionContainingDeclaration(contractMethod);
    const relation = owner === undefined ? undefined : program.projectTypes.relationship(fact.resultCarrier, owner);
    const implementation = implementations[implementationIndex];
    const signature = program.records.projectCallableSignature.get(contractMethod);
    if (owner === undefined || relation?.kind !== "related" || implementation === undefined || signature === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted literal method requires its exact instantiated owner and signature.", contractMethod);
    const substitutions = projectOwnerTypeSubstitutions(owner, relation.targetType);
    variant.sourceTypeParameterIdentities.forEach((identity, index) => {
      const carrier = variant.targetTypeArguments[index];
      if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted literal method requires its dense selected specialization.", contractMethod);
      substitutions.set(identity, carrier);
    });
    const parameters = sourceCallableParameterAbis(input, contractMethod, substitutions);
    const result = sourceCallableReturnCarrier(input, contractMethod, substitutions);
    const error = signature.errorCarrier === undefined ? undefined : substituteRustTargetTypeParameters(signature.errorCarrier, substitutions);
    const parameterCount = implementation.kind === "authored" ? implementation.parameters.length : implementation.parameterCount;
    if (parameters === undefined || result === undefined || selectedAdapter !== undefined &&
      (parameters.length !== selectedAdapter.parameters.length || selectedAdapter.parameterAdapters.length !== parameterCount) ||
      (implementation.error !== undefined || selectedAdapter?.adapterFallible === true) && error === undefined ||
      implementation.kind === "spread" && (parameters.length !== parameterCount || error === undefined || signature.safety.declaration))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted literal method requires its exact native parameter, result and error adapter ABI.", contractMethod);
    let overrideIndex: number | undefined;
    const usage = program.projectMethodProperties.usageFor(contractMethod) ?? program.projectMethodProperties.usageFor(implementation.propertyIdentity);
    if (usage?.writable === true) {
      if (error === undefined || signature.safety.declaration)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted writable literal method requires its exact fallible safe callable ABI.", contractMethod);
      const shape = { parameters: parameters.map(parameter => parameter.parameterCarrier), result, error };
      const existing = overrideByIdentity.get(implementation.propertyIdentity);
      if (existing !== undefined && !closedMetadataEquals(existing.signature, shape))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted writable literal method requires one exact physical callable ABI.", contractMethod);
      overrideIndex = existing?.index ?? overrides.length;
      if (existing === undefined) { overrides.push(methods.length); overrideByIdentity.set(implementation.propertyIdentity, { index: overrideIndex, signature: shape }); }
    }
    methods.push(Object.freeze({ contractMethod, owner, ownerCarrier: relation.targetType, variant, implementationIndex, adapter: selectedAdapter, overrideIndex }));
  };
  for (const dispatch of adapter?.dispatches ?? []) {
    const implementation = implementations[dispatch.implementationIndex];
    const contribution = final.get(dispatch.contractMethod);
    if (implementation?.kind !== "authored" || contribution?.kind !== "method" || contribution.expression !== implementation.sourceCallable) continue;
    const variant = program.projectMethodDispatch.variantsForMember(dispatch.contractMethod).find(candidate => candidate.virtualSlot === dispatch.virtualSlot);
    if (variant === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted literal method requires its exact checked specialization slot.", dispatch.contractMethod);
    append(dispatch.contractMethod, variant, dispatch.implementationIndex, dispatch);
  }
  for (const [contractMethod, contribution] of final) if (contribution.kind === "spread") {
    const source = contribution.methods.find(method => method.contractDeclaration === contractMethod);
    const protocol = source === undefined ? undefined : rustCallableProtocol(source.callableCarrier);
    const variants = program.projectMethodDispatch.variantsForMember(contractMethod);
    const variant = variants.length === 1 ? variants[0] : undefined;
    if (source === undefined || protocol === undefined || variant === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted spread method requires its exact native callable and single selected specialization.", contractMethod);
    const implementationIndex = implementations.length;
    implementations.push(Object.freeze({ kind: "spread", propertyIdentity: source.sourceDeclaration, contractMethod,
      carrier: source.callableCarrier, parameterCount: protocol.parameters.length, error: errorFor(source.sourceDeclaration) }));
    append(contractMethod, variant, implementationIndex, undefined);
  }
  for (const contract of contracts) {
    const selected = program.records.projectDispatchEmission.get(contract.definition);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted literal contract requires its exact native dispatch selection.", node);
    for (const required of selected.methods) if (!methods.some(method => method.contractMethod === required.declaration && method.variant.virtualSlot === required.variant.virtualSlot))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted literal requires every exact native contract method implementation.", required.declaration);
    for (const [declaration, chosen] of selected.fields) {
      const stored = fields.some(field => field.contracts.includes(declaration));
      const accessor = accessors.some(field => field.contracts.includes(declaration));
      if (stored === accessor || accessor && (!chosen.dispatch.read.fallible || chosen.dispatch.write?.fallible === false))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted literal field requires one exact native storage or accessor implementation.", declaration);
    }
  }
  return Object.freeze({ carrier: fact.resultCarrier, definition, contracts, fields: Object.freeze(fields), accessors: Object.freeze(accessors),
    implementations: Object.freeze(implementations), methods: Object.freeze(methods), overrides: Object.freeze(overrides),
    stateUsed: fields.length !== 0 || overrides.length !== 0 });
}
