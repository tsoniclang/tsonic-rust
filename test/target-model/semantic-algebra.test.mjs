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
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import {
  rustCarrierSupportsTrait,
  rustCarrierSupportsTraitBound,
  rustFnMutTrait,
  rustFnOnceTrait,
  rustFnTrait,
} from "../../dist/target-model/types/index.js";

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
    traitImplementations: Object.freeze([]),
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
