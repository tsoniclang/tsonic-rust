import type { Node, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { Node_Type, sourceTypeSyntaxRoot } from "@tsonic/target-api/source";
import { rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { rustSourceUnionTargetType, rustSourceUnionCarrierValue, rustOptionElementCarrier, rustSourceOptionalTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { sourceTypeCarrierForDeclaration } from "../operations/inputs.js";
import type { RustTypeAliasDeclarationFact } from "../../target-model/records/callables/callables-and-resources.js";
import { resolveRustTypeFamilyApplication, rustSourceTypeFamilyDeclaration } from "../source-evidence/types/resolution/type-families.js";
import { resolveRustEvidenceNodesToCommonCarrier } from "../source-evidence/types/resolution/source-evidence.js";
import { rustSourceUnionMemberDeclarationIsOwned } from "../../policy/identities/source-union-members.js";
import { rustSourceUnionValueTypes } from "../source-evidence/types/resolution/source-unions.js";
import { closeRustSuspendedStorage } from "../../policy/types/storage/suspended-storage.js";

export function reserveTypeAliasUnion(walk: RustFactWalk, declaration: Node): void {
  const {ast} = walk.context;
  const authoredType = Node_Type(ast, declaration);
  const root = sourceTypeSyntaxRoot(ast, authoredType);
  if (root === undefined || ast.kindName(root) !== "KindUnionType" ||
    walk.sourceTypes.enumVariantsForDeclaration(declaration) !== undefined ||
    walk.sourceTypes.carrierForDeclaration(declaration) !== undefined) return;
  const semantics = walk.context.semanticsFor(declaration);
  const sourceType = semantics.declarations.declaredType(declaration);
  if (sourceType === undefined || !semantics.types.isUnion(sourceType)) return;
  const carrier = resolveRustTargetTypeRef(authoredType, rustResolutionContext(walk, declaration), walk.operationOptions);
  if (carrier !== undefined) return;
  const contract = walk.context.sourceLifetimes.contractFor(declaration);
  if (ast.typeParameters(declaration).length !== (contract?.parameters.length ?? 0)) return;
  const typeName = ast.text(ast.name(declaration));
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  if (typeName.length === 0 || fileName.length === 0) return;
  const reference = rustSourceUnionTargetType(fileName, typeName,
    contract?.parameters.map(parameter => parameter.kind === "type"
      ? {kind: "type" as const, type: {kind: "type-parameter" as const, identity: parameter.identity, name: parameter.targetName}}
      : {kind: "lifetime" as const, lifetime: parameter.lifetime}) ?? []);
  const members = semantics.types.unionOrIntersectionTypes(sourceType);
  const absent = rustSourceUnionValueTypes(members, semantics).length !== members.length;
  walk.sourceTypes.reserveSourceUnion(declaration, absent ? rustSourceOptionalTargetType(reference) : reference);
}

export function selectRustTypeAliasDeclaration(
  walk: RustFactWalk,
  declaration: Node,
): RustTypeAliasDeclarationFact | undefined {
  const variants = walk.sourceTypes.enumVariantsForDeclaration(declaration);
  if (variants !== undefined) {
    const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
    if (carrier === undefined) {
      return undefined;
    }
    setCarrierFact(walk, declaration, carrier);
    return {
      kind: "string-literal",
      variants,
    };
  }
  const { ast } = walk.context;
  const sourceParameters = ast.typeParameters(declaration);
  const genericContract = sourceParameters.length === 0
    ? undefined
    : walk.context.sourceLifetimes.contractFor(declaration);
  if (sourceParameters.some((parameter) => parameter === undefined) ||
    (sourceParameters.length > 0 && (genericContract === undefined ||
      genericContract.parameters.length !== sourceParameters.length ||
      genericContract.parameters.some((parameter, index) =>
        parameter.declaration !== sourceParameters[index])))) {
    return undefined;
  }
  const lifetimeBearingAlias = genericContract?.parameters.some((parameter) =>
    parameter.kind === "lifetime") === true;
  const nameNode = ast.name(declaration);
  const typeName = nameNode === undefined ? "" : ast.text(nameNode);
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  const semantics = walk.context.semanticsFor(declaration);
  const sourceType = semantics.declarations.declaredType(declaration);
  if (sourceType === undefined || typeName.length === 0 || fileName.length === 0) {
    return undefined;
  }
  if (sourceParameters.length > 0 && !lifetimeBearingAlias) {
    const arguments_ = sourceParameters.map(parameter => semantics.declarations.declaredType(parameter!));
    const carriers = genericContract!.parameters.map(parameter => parameter.kind === "type"
      ? { kind: "type-parameter" as const, identity: parameter.identity, name: parameter.targetName } : undefined);
    const application = arguments_.some(argument => argument === undefined) ? undefined
      : semantics.types.instantiateAlias(declaration, arguments_ as readonly Type[]);
    const root = application?.conditionalSteps[0];
    const selectedFamily = root === undefined ? undefined
      : rustSourceTypeFamilyDeclaration(root.conditional, rustResolutionContext(walk, declaration));
    if (application?.kind === "conditional" && selectedFamily !== undefined) {
      const carrier = carriers.some(value => value === undefined) ? undefined
        : resolveRustTypeFamilyApplication(application, carriers as readonly TargetTypeRef[],
          rustResolutionContext(walk, declaration), walk.operationOptions, new Set());
      if (carrier !== undefined) {
        const family = walk.context.typeFamilies.get(selectedFamily.trait.id);
        if (family?.kind !== "conditional") return undefined;
        setCarrierFact(walk, declaration, carrier);
        return { kind: family.declaration === declaration ? "family" : "erased" };
      }
      return undefined;
    }
  }
  if (!semantics.types.isUnion(sourceType)) {
    const typeNode = Node_Type(ast, declaration);
    const carrier = resolveRustTargetTypeRef(
      typeNode ?? sourceType,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    if (carrier === undefined ||
      !walk.sourceTypes.registerRepresentationAlias(declaration, carrier)) {
      return undefined;
    }
    setCarrierFact(walk, declaration, carrier);
    if (typeNode !== undefined) {
      setCarrierFact(walk, typeNode, carrier);
    }
    return {
      ...(lifetimeBearingAlias
        ? { kind: "native-alias" as const, target: carrier }
        : { kind: "erased" as const }),
    };
  }
  reserveTypeAliasUnion(walk, declaration);
  const reservedCarrier = walk.sourceTypes.carrierForDeclaration(declaration);
  const reservedValue = rustOptionElementCarrier(reservedCarrier) ?? reservedCarrier;
  const compositeCarrier = rustSourceUnionCarrierValue(reservedValue) === undefined ? resolveRustTargetTypeRef(
    Node_Type(ast, declaration) ?? sourceType,
    rustResolutionContext(walk, declaration),
    walk.operationOptions,
  ) : undefined;
  if (compositeCarrier !== undefined) {
    const carrier = closeRustSuspendedStorage(compositeCarrier, "field");
    if (carrier === undefined || !walk.sourceTypes.registerRepresentationAlias(declaration, carrier)) {
      return undefined;
    }
    setCarrierFact(walk, declaration, carrier);
    return {
      ...(lifetimeBearingAlias
        ? { kind: "native-alias" as const, target: carrier }
        : { kind: "erased" as const }),
    };
  }
  const sourceMembers = semantics.types.unionOrIntersectionTypes(sourceType);
  if (!isDenseDataArray(sourceMembers) || sourceMembers.length < 2 ||
    sourceMembers.some((member) => member === undefined)) {
    return undefined;
  }
  const uniqueVariants: {
    readonly sourceTypes: Type[];
    readonly carrier: TargetTypeRef;
  }[] = [];
  const authoredType = Node_Type(ast, declaration);
  if (authoredType === undefined) return undefined;
  for (const member of rustSourceUnionValueTypes(sourceMembers as readonly Type[], semantics)) {
    const resolved = resolveRustEvidenceNodesToCommonCarrier(
      [authoredType],
      member,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
      new Set(),
    );
    const carrier = resolved === undefined ? undefined : closeRustSuspendedStorage(resolved, "field");
    if (carrier === undefined) {
      return undefined;
    }
    const existing = uniqueVariants.find(variant => rustTargetTypeRefEquals(variant.carrier, carrier));
    if (existing === undefined) uniqueVariants.push({ sourceTypes: [member], carrier });
    else if (!existing.sourceTypes.includes(member)) existing.sourceTypes.push(member);
  }
  if (uniqueVariants.length === 1 && rustSourceUnionCarrierValue(reservedValue) === undefined) {
    const carrier = uniqueVariants[0]!.carrier;
    if (!walk.sourceTypes.registerRepresentationAlias(declaration, carrier)) {
      return undefined;
    }
    setCarrierFact(walk, declaration, carrier);
    return {
      kind: "erased",
    };
  }
  const finalizedVariants = uniqueVariants.map((variant, index) => {
    const shape = walk.sourceTypes.structuralObjectForType(
      variant.sourceTypes[0]!,
      variant.carrier,
    );
    return {
      name: `Variant${index}`,
      sourceTypes: Object.freeze(variant.sourceTypes),
      carrier: variant.carrier,
      ...(shape === undefined ? {} : { shape }),
    };
  });
  const carrier = rustSourceUnionTargetType(
    fileName,
    typeName,
    genericContract?.parameters.map(parameter => parameter.kind === "type"
      ? { kind: "type" as const, type: { kind: "type-parameter" as const, identity: parameter.identity, name: parameter.targetName } }
      : { kind: "lifetime" as const, lifetime: parameter.lifetime }) ?? [],
  );
  const selectedProperties = semantics.types.propertyInfos(sourceType).map((property) => {
    const declarations = semantics.declarations.symbolDeclarations(property.symbol);
    if (!isDenseDataArray(declarations) || declarations.length === 0 ||
      declarations.some((selected) => selected === undefined)) {
      return undefined;
    }
    const selectedDeclarations = declarations as readonly Node[];
    return selectedDeclarations.every((selected) =>
      rustSourceUnionMemberDeclarationIsOwned(selected, rustResolutionContext(walk, declaration), walk.operationOptions))
      ? {
          symbol: property.symbol,
          declarations: Object.freeze([...selectedDeclarations]),
        }
      : undefined;
  });
  if (selectedProperties.some((property) => property === undefined)) {
    return undefined;
  }
  if (!walk.sourceTypes.registerSourceUnion({
    declaration,
    sourceType,
    carrier,
    variants: finalizedVariants,
    selectedProperties: selectedProperties as readonly {
      readonly symbol: import("@tsonic/tsts").Symbol;
      readonly declarations: readonly Node[];
    }[],
  })) {
    return undefined;
  }
  setCarrierFact(walk, declaration, reservedCarrier ?? carrier);
  return {
    kind: "runtime",
    variants: finalizedVariants.map((variant) => ({
      name: variant.name,
      carrier: variant.carrier,
    })),
  };
}
