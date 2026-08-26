import assert from "node:assert/strict";
import { test } from "node:test";

import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { applyRustProviderArgumentConversion } from "../../../dist/policy/operations/forms.js";
import {
  rustValueConversionContract,
  rustValueConversionIdentity,
} from "../../../dist/target-model/conversions/contracts.js";
import { rustBuiltinIdentity } from "../../../dist/target-model/semantics/index.js";
import {
  rustAsyncCallableTargetType,
  rustBorrowedAsyncCallableTargetType,
  rustBorrowedCallableTargetType,
  rustCallableTargetType,
  rustCallableBoundaryCanAdapt,
  rustCallableBoundaryProtocol,
  rustCallableSignaturesAlphaEquivalent,
  rustClosureTargetType,
  rustFutureTargetType,
  rustFixedArrayTargetType,
  rustFunctionPointerTargetType,
  rustInferredLifetime,
  rustJsArrayTargetType,
  rustJsValueTargetType,
  rustReferenceTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustThreadedAsyncCallableTargetType,
  rustThreadedCallableTargetType,
} from "../../../dist/target-model/types/index.js";

const int32 = rustSourcePrimitiveTargetType("int32");
const bool = rustSourcePrimitiveTargetType("bool");
const target = rustClosureTargetType({
  callTrait: "fn-mut",
  parameters: [int32],
  result: bool,
});

test("higher-ranked callable signatures compare bound lifetimes by binder position", () => {
  const signature = (binderId, parameterId, bounds = []) => {
    const lifetime = {
      kind: "bound",
      binderId,
      parameterId,
      displayName: parameterId,
    };
    return {
      binder: {
        id: binderId,
        lifetimes: [{ kind: "lifetime", identity: lifetime, bounds }],
      },
      parameters: [rustReferenceTargetType(int32, false, lifetime)],
      result: rustReferenceTargetType(int32, false, lifetime),
    };
  };

  assert.equal(
    rustCallableSignaturesAlphaEquivalent(
      signature("left-binder", "left-life"),
      signature("right-binder", "right-life"),
    ),
    true,
  );
  assert.equal(
    rustCallableSignaturesAlphaEquivalent(
      signature("left-binder", "left-life"),
      signature("right-binder", "right-life", [{ kind: "static" }]),
    ),
    false,
  );

  assert.equal(
    rustCallableSignaturesAlphaEquivalent(
      signature("left-binder", "left-life", [
        rustInferredLifetime("first"),
        { kind: "static" },
      ]),
      signature("right-binder", "right-life", [
        { kind: "static" },
        rustInferredLifetime("first"),
      ]),
    ),
    true,
  );
});

test("callable signature equality ignores display-only lifetime spelling", () => {
  const identity = {
    kind: "generated",
    artifactId: "callable-signature-test",
    itemId: "lifetime",
  };
  const signature = (displayName) => ({
    parameters: [rustReferenceTargetType(int32, false, {
      kind: "parameter",
      identity,
      displayName,
    })],
    result: bool,
  });

  assert.equal(
    rustCallableSignaturesAlphaEquivalent(signature("left"), signature("renamed")),
    true,
  );
  assert.equal(
    rustCallableSignaturesAlphaEquivalent(
      signature("same"),
      {
        parameters: [rustReferenceTargetType(int32, false, {
          kind: "parameter",
          identity: { ...identity, itemId: "different-lifetime" },
          displayName: "same",
        })],
        result: bool,
      },
    ),
    false,
  );
});

test("nested higher-ranked callable signatures normalize every lexical binder", () => {
  const signature = (binderId, parameterId, bounds = []) => {
    const lifetime = {
      kind: "bound",
      binderId,
      parameterId,
      displayName: parameterId,
    };
    const callback = rustFunctionPointerTargetType({
      binder: {
        id: binderId,
        lifetimes: [{ kind: "lifetime", identity: lifetime, bounds }],
      },
      parameters: [rustReferenceTargetType(int32, false, lifetime)],
      result: rustReferenceTargetType(int32, false, lifetime),
    });
    return { parameters: [callback], result: bool };
  };

  assert.equal(
    rustCallableSignaturesAlphaEquivalent(
      signature("nested-left", "nested-left-life"),
      signature("nested-right", "nested-right-life"),
    ),
    true,
  );
  assert.equal(
    rustCallableSignaturesAlphaEquivalent(
      signature("nested-left", "nested-left-life"),
      signature("nested-right", "nested-right-life", [{ kind: "static" }]),
    ),
    false,
  );
});

test("callable boundaries use exact signature and Rust call-trait substitutability", () => {
  const required = rustClosureTargetType({
    callTrait: "fn-mut",
    parameters: [int32],
    result: bool,
  });

  assert.equal(
    rustCallableBoundaryCanAdapt(rustCallableTargetType([int32], bool), required),
    true,
  );
  assert.equal(
    rustCallableBoundaryCanAdapt(
      rustClosureTargetType({ callTrait: "fn-once", parameters: [int32], result: bool }),
      required,
    ),
    false,
  );
  assert.equal(
    rustCallableBoundaryCanAdapt(rustCallableTargetType([bool], bool), required),
    false,
  );
});

test("synchronous runtime callable storage exposes an immediate-result boundary", () => {
  const sources = [
    rustCallableTargetType([int32], bool),
    rustBorrowedCallableTargetType(
      rustInferredLifetime("callable-conversion-test"),
      [int32],
      bool,
    ),
    rustThreadedCallableTargetType([int32], bool),
  ];

  for (const source of sources) {
    assert.deepEqual(rustCallableBoundaryProtocol(source), {
      callTrait: "fn",
      invocation: "runtime-call",
      failureChannel: "result",
      parameters: [int32],
      result: bool,
    });
    assert.equal(selectRustSourceValueConversion(source, target), undefined);
  }
});

test("runtime callable adaptation rejects every incompatible signature", () => {
  assert.equal(
    selectRustSourceValueConversion(rustCallableTargetType([], bool), target),
    undefined,
  );
  assert.equal(
    selectRustSourceValueConversion(rustCallableTargetType([int32], int32), target),
    undefined,
  );
  assert.equal(
    selectRustSourceValueConversion(rustCallableTargetType([bool], bool), target),
    undefined,
  );
});

test("async runtime callable storage requires an exact future error-channel boundary", () => {
  const futureInt32 = rustFutureTargetType(int32);
  const asyncTarget = rustClosureTargetType({
    callTrait: "fn-once",
    parameters: [bool],
    result: futureInt32,
  });
  const sources = [
    rustAsyncCallableTargetType([bool], int32),
    rustBorrowedAsyncCallableTargetType(
      rustInferredLifetime("async-callable-conversion-test"),
      [bool],
      int32,
    ),
    rustThreadedAsyncCallableTargetType([bool], int32),
  ];

  for (const source of sources) {
    assert.deepEqual(rustCallableBoundaryProtocol(source), {
      callTrait: "fn",
      invocation: "runtime-call",
      failureChannel: "future-output",
      parameters: [bool],
      result: futureInt32,
    });
    assert.equal(rustValueConversionContract({
      kind: "runtime-callable-callback",
      source,
      target: asyncTarget,
    }), undefined);
    assert.equal(selectRustSourceValueConversion(source, asyncTarget), undefined);
  }

  assert.equal(
    selectRustSourceValueConversion(
      rustAsyncCallableTargetType([bool], bool),
      asyncTarget,
    ),
    undefined,
  );
});

test("provider argument conversions follow exact source-to-target argument order", () => {
  const source = rustCallableTargetType([int32], bool);
  const conversion = { kind: "runtime-callable-callback", source, target };
  const reordered = { form: "call", path: "acme::run", argOrder: [1, 0] };

  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "exact",
    lowering: "runtime-callable-callback",
    sourceMode: "value",
    source,
    target,
    parameters: [int32],
    fallible: false,
  });

  assert.deepEqual(
    applyRustProviderArgumentConversion(reordered, 0, 2, conversion),
    {
      ...reordered,
      argConversions: [undefined, conversion],
    },
  );
  assert.deepEqual(
    applyRustProviderArgumentConversion(reordered, 1, 2, conversion),
    {
      ...reordered,
      argConversions: [conversion, undefined],
    },
  );
  assert.equal(
    applyRustProviderArgumentConversion(
      { ...reordered, argConversions: [conversion, undefined] },
      1,
      2,
      conversion,
    ),
    undefined,
  );
  assert.equal(
    applyRustProviderArgumentConversion(
      { form: "arg-receiver-method", name: "run" },
      0,
      2,
      conversion,
    ),
    undefined,
  );
  assert.deepEqual(
    applyRustProviderArgumentConversion(
      { form: "arg-receiver-method", name: "run" },
      1,
      2,
      conversion,
    ),
    {
      form: "arg-receiver-method",
      name: "run",
      argConversions: [undefined, conversion],
    },
  );
});

test("callable conversion identities use semantic type structure with const arguments", () => {
  const fixed = rustFixedArrayTargetType(int32, 3);
  const source = rustCallableTargetType([fixed], bool);
  const target = rustClosureTargetType({
    callTrait: "fn",
    parameters: [fixed],
    result: bool,
  });

  assert.doesNotThrow(() => rustValueConversionIdentity({
    kind: "runtime-callable-callback",
    source,
    target,
  }));
});

test("callable alpha normalization rejects cyclic, over-deep, oversized, and malformed inputs", () => {
  const cyclic = { parameters: [], result: undefined };
  cyclic.result = cyclic;
  assert.doesNotThrow(() => rustCallableSignaturesAlphaEquivalent(cyclic, cyclic));
  assert.equal(rustCallableSignaturesAlphaEquivalent(cyclic, cyclic), false);

  const deepSignature = () => {
    let result = int32;
    for (let depth = 0; depth < 300; depth += 1) {
      result = rustReferenceTargetType(
        result,
        false,
        rustInferredLifetime(`depth-${depth}`),
      );
    }
    return { parameters: [], result };
  };
  assert.equal(
    rustCallableSignaturesAlphaEquivalent(deepSignature(), deepSignature()),
    false,
  );

  const oversizedLifetime = rustInferredLifetime("x".repeat(1_048_577));
  const oversized = {
    parameters: [rustReferenceTargetType(int32, false, oversizedLifetime)],
    result: bool,
  };
  assert.equal(rustCallableSignaturesAlphaEquivalent(oversized, oversized), false);

  const manyPathSegments = Object.freeze(Array.from(
    { length: 33_000 },
    () => "segment",
  ));
  const aggregateOversizedPath = Object.freeze({
    kind: "path",
    identity: rustBuiltinIdentity("test::AggregateOversized"),
    displayPath: manyPathSegments,
    arguments: Object.freeze([]),
  });
  const aggregateOversized = Object.freeze({
    parameters: Object.freeze([aggregateOversizedPath, aggregateOversizedPath]),
    result: bool,
  });
  assert.equal(
    rustCallableSignaturesAlphaEquivalent(aggregateOversized, aggregateOversized),
    false,
  );

  const bound = {
    kind: "bound",
    binderId: "duplicate-binder",
    parameterId: "duplicate-life",
    displayName: "duplicate-life",
  };
  const malformedBinder = {
    binder: {
      id: "duplicate-binder",
      lifetimes: [
        { kind: "lifetime", identity: bound, bounds: [] },
        { kind: "lifetime", identity: bound, bounds: [] },
      ],
    },
    parameters: [rustReferenceTargetType(int32, false, bound)],
    result: bool,
  };
  assert.equal(
    rustCallableSignaturesAlphaEquivalent(malformedBinder, malformedBinder),
    false,
  );
});

test("argument-vector adapters cannot hide a fallible runtime callable invocation", () => {
  const string = rustStringTargetType();
  const values = rustJsArrayTargetType(rustJsValueTargetType());
  const source = rustCallableTargetType([string, values], string);
  const replacement = rustClosureTargetType({
    callTrait: "fn-mut",
    parameters: [values],
    result: string,
  });
  const conversion = {
    kind: "js-argument-vector-callback",
    lane: "native",
    source,
    target: replacement,
    projections: ["native-string", "rest-values"],
  };

  assert.equal(rustValueConversionContract({
    ...conversion,
    sourceInvocationReturnsResult: false,
  }), undefined);
  assert.ok(rustValueConversionContract({
    ...conversion,
    sourceInvocationReturnsResult: true,
  }));

  assert.equal(rustValueConversionContract({
    ...conversion,
    source: rustAsyncCallableTargetType([string, values], string),
    sourceInvocationReturnsResult: true,
  }), undefined);
});
