import assert from "node:assert/strict";
import { test } from "node:test";

import {
  rustGenericArgumentSemanticKey,
  rustGenericsSemanticKey,
  rustLifetimeSemanticKey,
  rustTypeSemanticKey,
} from "../../dist/target-model/semantics/keys.js";
import {
  rustGenericSubstitutionsForArguments,
  substituteRustTargetGenerics,
} from "../../dist/target-model/types/generic-substitution.js";
import {
  isRustBinderValue,
  isRustBoundValue,
  isRustTargetTypeRef,
  isRustTraitReference,
  rustTargetTypeRefEquals,
} from "../../dist/target-model/types/equality.js";
import {
  createRustNamedTypeTraitContractIndex,
  createRustTraitSupportQueries,
  isRustStringCarrier,
  rustCallableProtocol,
  rustCallableTargetType,
  rustCloneTrait,
  rustCopyTrait,
  rustDefaultTrait,
  rustEqTrait,
  rustFnMutTrait,
  rustFnOnceTrait,
  rustFnTrait,
  rustHashTrait,
  rustSendTrait,
  rustOpaqueTargetType,
  rustSyncTrait,
  rustTupleTargetType,
  rustUnpinTrait,
} from "../../dist/target-model/types/index.js";
import {
  isRustNamedTypeTraitContract,
  rustPathTargetType,
} from "../../dist/target-model/types/index.js";
import {
  closedMetadataEquals,
  closedMetadataKey,
} from "../../dist/target-model/metadata/closed-data.js";

const projectIdentity = (declarationId) => Object.freeze({
  kind: "project",
  packageId: "fixture",
  sourceFileId: "/src/index.ts",
  declarationId,
});

const lifetimeParameter = (declarationId, displayName = "L") => Object.freeze({
  kind: "parameter",
  identity: projectIdentity(declarationId),
  displayName,
});

const typeParameter = (declarationId, displayName = "T") => Object.freeze({
  kind: "type-parameter",
  identity: projectIdentity(declarationId),
  displayName,
});

const constParameter = (declarationId, displayName = "N") => Object.freeze({
  kind: "parameter",
  identity: projectIdentity(declarationId),
  displayName,
});

const emptyTraitSupport = createRustTraitSupportQueries(
  createRustNamedTypeTraitContractIndex([]),
);
const rustCarrierSupportsTrait = (carrier, trait) =>
  emptyTraitSupport.supportsTrait(carrier, trait);
const rustCarrierSupportsTraitBound = (carrier, bound) =>
  emptyTraitSupport.supportsTraitBound(carrier, bound);

test("unit is the one canonical zero-element Rust tuple representation", () => {
  const result = Object.freeze({ kind: "primitive", name: "i32" });
  const unit = rustTupleTargetType([]);
  const invalidEmptyTuple = Object.freeze({ kind: "tuple", elements: Object.freeze([]) });
  const single = rustTupleTargetType([result]);

  assert.deepEqual(unit, Object.freeze({ kind: "unit" }));
  assert.equal(isRustTargetTypeRef(unit), true);
  assert.equal(isRustTargetTypeRef(invalidEmptyTuple), false);
  assert.equal(single.kind, "tuple");
  assert.equal(rustCallableProtocol(rustCallableTargetType([], result))?.parameters.length, 0);
});

test("Rust semantic carriers reject non-canonical binders and malformed target forms", () => {
  const boundLifetime = Object.freeze({
    kind: "bound",
    binderId: "binder",
    parameterId: "life",
    displayName: "a",
  });
  const lifetimeParameter = Object.freeze({
    kind: "lifetime",
    identity: boundLifetime,
    bounds: Object.freeze([]),
  });
  const validBinder = Object.freeze({
    id: "binder",
    lifetimes: Object.freeze([lifetimeParameter]),
  });
  assert.equal(isRustBinderValue(validBinder), true);
  assert.equal(isRustBinderValue(Object.freeze({ id: "binder", lifetimes: Object.freeze([]) })), false);
  assert.equal(isRustBinderValue(Object.freeze({
    id: "other",
    lifetimes: Object.freeze([lifetimeParameter]),
  })), false);
  assert.equal(isRustBinderValue(Object.freeze({
    id: "binder",
    lifetimes: Object.freeze([lifetimeParameter, lifetimeParameter]),
  })), false);

  const unit = Object.freeze({ kind: "unit" });
  assert.equal(isRustTargetTypeRef(Object.freeze({
    kind: "function-pointer",
    safety: "safe",
    abi: "Rust",
    parameters: Object.freeze([]),
    variadic: true,
    result: unit,
  })), false);
  assert.equal(isRustBoundValue(Object.freeze({
    kind: "precise-capture",
    captures: Object.freeze([]),
  })), false);
  assert.equal(isRustTargetTypeRef(Object.freeze({
    kind: "opaque",
    identity: projectIdentity("opaque:empty"),
    bounds: Object.freeze([]),
    captures: Object.freeze([]),
  })), false);
  assert.equal(isRustTargetTypeRef(Object.freeze({
    kind: "trait-object",
    principal: rustSendTrait,
    autoTraits: Object.freeze([rustSendTrait]),
    lifetime: Object.freeze({ kind: "static" }),
  })), false);
  const capture = Object.freeze({
    kind: "type",
    identity: projectIdentity("capture:type"),
    displayName: "T",
  });
  assert.equal(isRustTargetTypeRef(Object.freeze({
    kind: "closure",
    callTrait: "fn",
    parameters: Object.freeze([]),
    result: unit,
    captures: Object.freeze([capture, capture]),
  })), false);
  assert.equal(isRustTargetTypeRef(Object.freeze({
    kind: "array",
    element: unit,
    length: Object.freeze({
      kind: "literal",
      literalKind: "character",
      value: "\ud800",
    }),
  })), false);
});

test("opaque captures have one canonical semantic owner and deterministic order", () => {
  const typeCapture = Object.freeze({
    kind: "type",
    identity: projectIdentity("capture:type"),
    displayName: "T",
  });
  const lifetimeCapture = Object.freeze({
    kind: "lifetime",
    value: lifetimeParameter("capture:lifetime", "a"),
  });
  const traitBound = Object.freeze({
    kind: "trait",
    trait: rustSendTrait,
    polarity: "required",
  });
  const opaque = rustOpaqueTargetType({
    identity: projectIdentity("opaque:ordered"),
    bounds: [traitBound],
    captures: [typeCapture, lifetimeCapture],
  });

  assert.deepEqual(opaque.captures, [lifetimeCapture, typeCapture]);
  assert.equal(isRustTargetTypeRef(opaque), true);
  assert.equal(isRustTargetTypeRef(Object.freeze({
    ...opaque,
    captures: Object.freeze([typeCapture, lifetimeCapture]),
  })), false);
});

test("closed metadata equality and identity distinguish negative zero", () => {
  assert.equal(closedMetadataEquals(0, -0), false);
  assert.notEqual(closedMetadataKey(0), closedMetadataKey(-0));
});

test("semantic keys use declaration identity rather than display spelling", () => {
  const first = lifetimeParameter("life:first", "L");
  const second = lifetimeParameter("life:second", "L");
  const renamed = lifetimeParameter("life:first", "Renamed");

  assert.notEqual(rustLifetimeSemanticKey(first), rustLifetimeSemanticKey(second));
  assert.equal(rustLifetimeSemanticKey(first), rustLifetimeSemanticKey(renamed));

  const firstType = typeParameter("type:first", "T");
  const secondType = typeParameter("type:second", "T");
  assert.notEqual(rustTypeSemanticKey(firstType), rustTypeSemanticKey(secondType));
  assert.equal(
    rustTypeSemanticKey(firstType),
    rustTypeSemanticKey({ ...firstType, displayName: "Renamed" }),
  );
});

test("mixed generic arguments preserve kind, order, and exact identity", () => {
  const lifetime = lifetimeParameter("life:l");
  const type = typeParameter("type:t");
  const constant = Object.freeze({
    kind: "parameter",
    identity: projectIdentity("const:n"),
    displayName: "N",
  });
  const argumentsList = Object.freeze([
    { kind: "lifetime", value: lifetime },
    { kind: "type", value: type },
    { kind: "const", value: constant },
  ]);

  assert.notEqual(
    rustGenericArgumentSemanticKey(argumentsList[0]),
    rustGenericArgumentSemanticKey(argumentsList[1]),
  );
  assert.notEqual(
    argumentsList.map(rustGenericArgumentSemanticKey).join("|"),
    [argumentsList[1], argumentsList[0], argumentsList[2]]
      .map(rustGenericArgumentSemanticKey)
      .join("|"),
  );
});

test("generic substitution rejects kind collapse and substitutes all three domains", () => {
  const lifetime = lifetimeParameter("life:l");
  const type = typeParameter("type:t");
  const constant = constParameter("const:n");
  const generics = Object.freeze({
    parameters: Object.freeze([
      { kind: "lifetime", identity: lifetime, bounds: Object.freeze([]) },
      {
        kind: "type",
        identity: type.identity,
        displayName: type.displayName,
        bounds: Object.freeze([]),
      },
      {
        kind: "const",
        identity: constant.identity,
        displayName: constant.displayName,
        type: Object.freeze({ kind: "primitive", name: "usize" }),
      },
    ]),
    wherePredicates: Object.freeze([]),
  });
  const concreteLifetime = Object.freeze({ kind: "static" });
  const concreteType = Object.freeze({ kind: "primitive", name: "i32" });
  const concreteConst = Object.freeze({ kind: "literal", literalKind: "integer", value: 4n });
  const substitutions = rustGenericSubstitutionsForArguments(generics, Object.freeze([
    { kind: "lifetime", value: concreteLifetime },
    { kind: "type", value: concreteType },
    { kind: "const", value: concreteConst },
  ]));

  assert.ok(substitutions);
  assert.equal(
    rustTypeSemanticKey(substituteRustTargetGenerics(Object.freeze({
      kind: "reference",
      lifetime,
      mutable: false,
      target: Object.freeze({
        kind: "array",
        element: type,
        length: constant,
      }),
    }), substitutions)),
    rustTypeSemanticKey(Object.freeze({
      kind: "reference",
      lifetime: concreteLifetime,
      mutable: false,
      target: Object.freeze({
        kind: "array",
        element: concreteType,
        length: concreteConst,
      }),
    })),
  );
  assert.equal(rustGenericSubstitutionsForArguments(generics, Object.freeze([
    { kind: "type", value: concreteType },
    { kind: "lifetime", value: concreteLifetime },
    { kind: "const", value: concreteConst },
  ])), undefined);
});

test("associated, trait-object, and opaque identities remain structurally distinct", () => {
  const owner = Object.freeze({
    kind: "path",
    identity: projectIdentity("type:owner"),
    displayPath: Object.freeze(["Owner"]),
    arguments: Object.freeze([]),
  });
  const trait = Object.freeze({
    identity: projectIdentity("trait:iter"),
    displayPath: Object.freeze(["Iterator"]),
    arguments: Object.freeze([]),
    associatedConstraints: Object.freeze([]),
  });
  const associated = Object.freeze({
    kind: "associated-type",
    owner,
    trait,
    item: projectIdentity("trait:iter:item"),
    displayName: "Item",
    arguments: Object.freeze([{ kind: "lifetime", value: lifetimeParameter("life:item") }]),
  });
  const otherAssociated = Object.freeze({
    ...associated,
    item: projectIdentity("trait:other:item"),
  });
  assert.notEqual(rustTypeSemanticKey(associated), rustTypeSemanticKey(otherAssociated));

  const object = Object.freeze({
    kind: "trait-object",
    principal: trait,
    autoTraits: Object.freeze([]),
    lifetime: lifetimeParameter("life:object"),
  });
  const staticObject = Object.freeze({ ...object, lifetime: Object.freeze({ kind: "static" }) });
  assert.notEqual(rustTypeSemanticKey(object), rustTypeSemanticKey(staticObject));

  const opaque = Object.freeze({
    kind: "opaque",
    identity: projectIdentity("opaque:first"),
    bounds: Object.freeze([{ kind: "trait", trait, polarity: "required" }]),
    captures: Object.freeze([{ kind: "lifetime", value: lifetimeParameter("life:opaque") }]),
  });
  assert.notEqual(
    rustTypeSemanticKey(opaque),
    rustTypeSemanticKey({ ...opaque, identity: projectIdentity("opaque:second") }),
  );
});

test("trait references reject duplicate or textually ambiguous associated projections", () => {
  const traitIdentity = projectIdentity("trait:generic");
  const firstItemIdentity = projectIdentity("trait:generic:item:first");
  const secondItemIdentity = projectIdentity("trait:generic:item:second");
  const argument = Object.freeze({
    kind: "type",
    value: Object.freeze({ kind: "primitive", name: "i32" }),
  });
  const equality = (item, displayName, selectedArgument = argument) => Object.freeze({
    kind: "equality",
    item,
    displayName,
    arguments: Object.freeze([selectedArgument]),
    type: Object.freeze({ kind: "primitive", name: "u32" }),
  });
  const trait = (associatedConstraints) => Object.freeze({
    identity: traitIdentity,
    displayPath: Object.freeze(["Generic"]),
    arguments: Object.freeze([]),
    associatedConstraints: Object.freeze(associatedConstraints),
  });

  assert.equal(isRustTraitReference(trait([equality(firstItemIdentity, "Item")])), true);
  assert.equal(isRustTraitReference(trait([
    equality(firstItemIdentity, "Item"),
    equality(firstItemIdentity, "Item"),
  ])), false);
  assert.equal(isRustTraitReference(trait([
    equality(firstItemIdentity, "Item"),
    equality(secondItemIdentity, "Item"),
  ])), false);
  assert.equal(isRustTraitReference(trait([
    equality(firstItemIdentity, "Item"),
    equality(firstItemIdentity, "Item", Object.freeze({
      kind: "type",
      value: Object.freeze({ kind: "primitive", name: "u64" }),
    })),
  ])), true);
});

test("where-clause keys distinguish lifetime and type-outlives relations", () => {
  const shorter = lifetimeParameter("life:shorter", "A");
  const longer = lifetimeParameter("life:longer", "B");
  const type = typeParameter("type:value", "T");
  const generics = Object.freeze({
    parameters: Object.freeze([
      { kind: "lifetime", identity: shorter, bounds: Object.freeze([]) },
      { kind: "lifetime", identity: longer, bounds: Object.freeze([shorter]) },
      {
        kind: "type",
        identity: type.identity,
        displayName: type.displayName,
        bounds: Object.freeze([{
          kind: "type-outlives",
          type,
          lifetime: shorter,
        }]),
      },
    ]),
    wherePredicates: Object.freeze([
      { kind: "lifetime", lifetime: longer, outlives: Object.freeze([shorter]) },
      {
        kind: "type",
        type,
        bounds: Object.freeze([{
          kind: "type-outlives",
          type,
          lifetime: shorter,
        }]),
      },
    ]),
  });

  const key = rustGenericsSemanticKey(generics);
  assert.match(key, /where:lifetime/u);
  assert.match(key, /bound:type/u);
  assert.match(key, /where:type/u);
});

test("higher-ranked closure binders participate in exact type identity", () => {
  const closure = (binderId, parameterId) => {
    const lifetime = Object.freeze({
      kind: "bound",
      binderId,
      parameterId,
      displayName: "l",
    });
    return Object.freeze({
      kind: "closure",
      binder: Object.freeze({
        id: binderId,
        lifetimes: Object.freeze([Object.freeze({
          kind: "lifetime",
          identity: lifetime,
          bounds: Object.freeze([]),
        })]),
      }),
      callTrait: "fn",
      parameters: Object.freeze([Object.freeze({
        kind: "reference",
        lifetime,
        mutable: false,
        target: Object.freeze({ kind: "primitive", name: "i32" }),
      })]),
      result: Object.freeze({ kind: "unit" }),
      captures: Object.freeze([]),
    });
  };
  const first = closure("binder:first", "life:value");
  const same = closure("binder:first", "life:value");
  const otherBinder = closure("binder:second", "life:value");
  const otherParameter = closure("binder:first", "life:other");

  assert.equal(rustTargetTypeRefEquals(first, same), true);
  assert.equal(rustTypeSemanticKey(first), rustTypeSemanticKey(same));
  assert.equal(rustTargetTypeRefEquals(first, otherBinder), false);
  assert.equal(rustTargetTypeRefEquals(first, otherParameter), false);
  assert.notEqual(rustTypeSemanticKey(first), rustTypeSemanticKey(otherBinder));
  assert.notEqual(rustTypeSemanticKey(first), rustTypeSemanticKey(otherParameter));
});

test("Fn, FnMut, and FnOnce requirements preserve the exact Rust call-trait lattice", () => {
  const parameter = Object.freeze({ kind: "primitive", name: "i32" });
  const result = Object.freeze({ kind: "primitive", name: "bool" });
  const trait = (base, selectedParameter = parameter, selectedResult = result) => Object.freeze({
    ...base,
    arguments: Object.freeze([{
      kind: "type",
      value: Object.freeze({ kind: "tuple", elements: Object.freeze([selectedParameter]) }),
    }]),
    associatedConstraints: Object.freeze([{
      kind: "equality",
      item: projectIdentity("core:ops:fn-once:output"),
      displayName: "Output",
      arguments: Object.freeze([]),
      type: selectedResult,
    }]),
  });
  const closure = (callTrait) => Object.freeze({
    kind: "closure",
    callTrait,
    parameters: Object.freeze([parameter]),
    result,
    captures: Object.freeze([]),
  });

  assert.equal(rustCarrierSupportsTrait(closure("fn"), trait(rustFnTrait)), true);
  assert.equal(rustCarrierSupportsTrait(closure("fn"), trait(rustFnMutTrait)), true);
  assert.equal(rustCarrierSupportsTrait(closure("fn"), trait(rustFnOnceTrait)), true);
  assert.equal(rustCarrierSupportsTrait(closure("fn-mut"), trait(rustFnTrait)), false);
  assert.equal(rustCarrierSupportsTrait(closure("fn-mut"), trait(rustFnMutTrait)), true);
  assert.equal(rustCarrierSupportsTrait(closure("fn-mut"), trait(rustFnOnceTrait)), true);
  assert.equal(rustCarrierSupportsTrait(closure("fn-once"), trait(rustFnTrait)), false);
  assert.equal(rustCarrierSupportsTrait(closure("fn-once"), trait(rustFnMutTrait)), false);
  assert.equal(rustCarrierSupportsTrait(closure("fn-once"), trait(rustFnOnceTrait)), true);
  assert.equal(
    rustCarrierSupportsTrait(
      closure("fn"),
      trait(rustFnTrait, Object.freeze({ kind: "primitive", name: "u32" })),
    ),
    false,
  );
  assert.equal(
    rustCarrierSupportsTrait(
      closure("fn"),
      trait(rustFnTrait, parameter, Object.freeze({ kind: "unit" })),
    ),
    false,
  );
});

test("higher-ranked callable requirements compare bound lifetimes by binder position", () => {
  const boundCallable = (binderId, parameterId) => {
    const lifetime = Object.freeze({
      kind: "bound",
      binderId,
      parameterId,
      displayName: "l",
    });
    const binder = Object.freeze({
      id: binderId,
      lifetimes: Object.freeze([Object.freeze({
        kind: "lifetime",
        identity: lifetime,
        bounds: Object.freeze([]),
      })]),
    });
    const parameter = Object.freeze({
      kind: "reference",
      lifetime,
      mutable: false,
      target: Object.freeze({ kind: "primitive", name: "i32" }),
    });
    return Object.freeze({
      binder,
      carrier: Object.freeze({
        kind: "closure",
        binder,
        callTrait: "fn",
        parameters: Object.freeze([parameter]),
        result: Object.freeze({ kind: "unit" }),
        captures: Object.freeze([]),
      }),
      trait: Object.freeze({
        ...rustFnTrait,
        arguments: Object.freeze([{
          kind: "type",
          value: Object.freeze({ kind: "tuple", elements: Object.freeze([parameter]) }),
        }]),
        associatedConstraints: Object.freeze([{
          kind: "equality",
          item: projectIdentity("core:ops:fn-once:output"),
          displayName: "Output",
          arguments: Object.freeze([]),
          type: Object.freeze({ kind: "unit" }),
        }]),
      }),
    });
  };
  const callable = boundCallable("callable", "callable-life");
  const alphaEquivalent = boundCallable("requirement", "requirement-life");
  const extraLifetime = Object.freeze({
    ...alphaEquivalent.binder,
    lifetimes: Object.freeze([
      ...alphaEquivalent.binder.lifetimes,
      Object.freeze({
        kind: "lifetime",
        identity: Object.freeze({
          kind: "bound",
          binderId: "requirement",
          parameterId: "second-life",
          displayName: "other",
        }),
        bounds: Object.freeze([]),
      }),
    ]),
  });

  assert.equal(rustCarrierSupportsTraitBound(callable.carrier, Object.freeze({
    kind: "trait",
    binder: alphaEquivalent.binder,
    trait: alphaEquivalent.trait,
    polarity: "required",
  })), true);
  assert.equal(rustCarrierSupportsTraitBound(callable.carrier, Object.freeze({
    kind: "trait",
    binder: extraLifetime,
    trait: alphaEquivalent.trait,
    polarity: "required",
  })), false);
});

test("native trait evidence binds mixed generic arguments without kind collapse", () => {
  const lifetime = lifetimeParameter("implementation:lifetime", "a");
  const type = typeParameter("implementation:type", "T");
  const constant = constParameter("implementation:const", "N");
  const parameters = Object.freeze([
    Object.freeze({ kind: "lifetime", value: lifetime }),
    Object.freeze({ kind: "type", value: type }),
    Object.freeze({ kind: "const", value: constant }),
  ]);
  const trait = Object.freeze({
    identity: projectIdentity("trait:mixed"),
    displayPath: Object.freeze(["Mixed"]),
    arguments: parameters,
    associatedConstraints: Object.freeze([]),
  });
  const implementation = Object.freeze({
    trait,
    genericBindings: Object.freeze(parameters.map((parameter, genericArgumentIndex) =>
      Object.freeze({ parameter, genericArgumentIndex }))),
    requirements: Object.freeze([Object.freeze({
      genericArgumentIndex: 1,
      bound: Object.freeze({
        kind: "trait",
        trait: rustCloneTrait,
        polarity: "required",
      }),
    })]),
  });
  const contract = Object.freeze({ implementations: Object.freeze([implementation]) });
  assert.equal(isRustNamedTypeTraitContract(contract), true);

  const concreteArguments = Object.freeze([
    Object.freeze({ kind: "lifetime", value: Object.freeze({ kind: "static" }) }),
    Object.freeze({ kind: "type", value: Object.freeze({ kind: "primitive", name: "i32" }) }),
    Object.freeze({
      kind: "const",
      value: Object.freeze({ kind: "literal", literalKind: "integer", value: 4n }),
    }),
  ]);
  const carrierIdentity = projectIdentity("type:mixed");
  const traitSupport = createRustTraitSupportQueries(
    createRustNamedTypeTraitContractIndex([Object.freeze({
      typeIdentity: carrierIdentity,
      contract,
    })]),
  );
  const carrier = rustPathTargetType({
    identity: carrierIdentity,
    displayPath: Object.freeze(["MixedType"]),
    arguments: concreteArguments,
  });
  const selectedTrait = Object.freeze({
    ...trait,
    arguments: concreteArguments,
  });
  assert.equal(traitSupport.supportsTrait(carrier, selectedTrait), true);
  const nonCloneArguments = Object.freeze([
    concreteArguments[0],
    Object.freeze({ kind: "type", value: Object.freeze({ kind: "str" }) }),
    concreteArguments[2],
  ]);
  assert.equal(traitSupport.supportsTrait(Object.freeze({
    ...carrier,
    arguments: nonCloneArguments,
  }), Object.freeze({ ...trait, arguments: nonCloneArguments })), false);

  assert.equal(isRustNamedTypeTraitContract({
    implementations: [{
      ...implementation,
      genericBindings: [
        implementation.genericBindings[0],
        { ...implementation.genericBindings[1], genericArgumentIndex: 0 },
        implementation.genericBindings[2],
      ],
    }],
  }), false);
  assert.equal(isRustNamedTypeTraitContract({
    implementations: [{
      ...implementation,
      requirements: [{
        ...implementation.requirements[0],
        bound: { ...implementation.requirements[0].bound, polarity: "maybe" },
      }],
    }],
  }), false);
});

test("builtin carrier policy requires exact builtin semantic identity", () => {
  const collidingProviderType = rustPathTargetType({
    identity: Object.freeze({
      kind: "provider",
      providerId: "fixture.provider",
      compilationSnapshotId: "fixture@1",
      itemId: "rust.std.String",
    }),
    displayPath: Object.freeze(["fixture", "String"]),
  });

  assert.equal(isRustStringCarrier(collidingProviderType), false);
  assert.equal(emptyTraitSupport.supportsTrait(collidingProviderType, rustCloneTrait), false);
  assert.equal(emptyTraitSupport.supportsTrait(collidingProviderType, rustEqTrait), false);
});

test("built-in Rust trait rules preserve references, DSTs, tuples, arrays, and auto traits", () => {
  const i32 = Object.freeze({ kind: "primitive", name: "i32" });
  const shared = Object.freeze({
    kind: "reference",
    lifetime: Object.freeze({ kind: "static" }),
    mutable: false,
    target: i32,
  });
  const mutable = Object.freeze({ ...shared, mutable: true });
  const raw = Object.freeze({ kind: "raw-pointer", mutable: true, target: i32 });
  const pointer = Object.freeze({
    kind: "function-pointer",
    safety: "safe",
    abi: "Rust",
    parameters: Object.freeze([i32]),
    variadic: false,
    result: i32,
  });
  assert.equal(rustCarrierSupportsTrait(shared, rustCloneTrait), true);
  assert.equal(rustCarrierSupportsTrait(mutable, rustCloneTrait), false);
  assert.equal(rustCarrierSupportsTrait(Object.freeze({ kind: "str" }), rustCopyTrait), false);
  assert.equal(rustCarrierSupportsTrait(Object.freeze({ kind: "str" }), rustCloneTrait), false);
  assert.equal(rustCarrierSupportsTrait(Object.freeze({ kind: "str" }), rustEqTrait), true);
  assert.equal(rustCarrierSupportsTrait(Object.freeze({ kind: "str" }), rustHashTrait), true);
  assert.equal(rustCarrierSupportsTrait(raw, rustSendTrait), false);
  assert.equal(rustCarrierSupportsTrait(raw, rustSyncTrait), false);
  assert.equal(rustCarrierSupportsTrait(raw, rustUnpinTrait), true);
  for (const trait of [rustCopyTrait, rustCloneTrait, rustEqTrait, rustHashTrait, rustSendTrait, rustSyncTrait, rustUnpinTrait]) {
    assert.equal(rustCarrierSupportsTrait(pointer, trait), true);
  }
  assert.equal(rustCarrierSupportsTrait(Object.freeze({
    kind: "tuple",
    elements: Object.freeze(Array.from({ length: 13 }, () => i32)),
  }), rustCopyTrait), false);
  assert.equal(rustCarrierSupportsTrait(Object.freeze({
    kind: "array",
    element: i32,
    length: Object.freeze({ kind: "literal", literalKind: "integer", value: 32n }),
  }), rustDefaultTrait), true);
  assert.equal(rustCarrierSupportsTrait(Object.freeze({
    kind: "array",
    element: i32,
    length: Object.freeze({ kind: "literal", literalKind: "integer", value: 33n }),
  }), rustDefaultTrait), false);

  const principal = Object.freeze({
    identity: projectIdentity("trait:handler"),
    displayPath: Object.freeze(["Handler"]),
    arguments: Object.freeze([]),
    associatedConstraints: Object.freeze([]),
  });
  const object = Object.freeze({
    kind: "trait-object",
    principal,
    autoTraits: Object.freeze([rustSendTrait]),
    lifetime: Object.freeze({ kind: "static" }),
  });
  assert.equal(rustCarrierSupportsTrait(object, principal), true);
  assert.equal(rustCarrierSupportsTrait(object, rustSendTrait), true);
  assert.equal(rustCarrierSupportsTrait(object, rustSyncTrait), false);
  const opaque = Object.freeze({
    kind: "opaque",
    identity: projectIdentity("opaque:send"),
    bounds: Object.freeze([Object.freeze({
      kind: "trait",
      trait: rustSendTrait,
      polarity: "required",
    })]),
    captures: Object.freeze([]),
  });
  assert.equal(rustCarrierSupportsTrait(opaque, rustSendTrait), true);
  assert.equal(rustCarrierSupportsTrait(opaque, rustSyncTrait), false);
});
