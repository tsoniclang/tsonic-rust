# JS/Node lane inventory relative to the C# target surface

Classification of JS/Node lanes reviewed against the C# target surface.
The machine-checked list lives in docs/parity-lanes.json; every listed
lane carries exactly one classification — implemented (positive runtime
proof in the generated Cargo bank), hard-rejected (architecture;
zero-artifact proof), or blocked by a named contract — and the guard test
keeps this document and the lane list from drifting. C# lanes without
Rust rows (Object helpers, Number helpers, bare
module aliases, Date extras, and process stdio) are enumerated in
the blocked section with the contract each requires.

## Implemented

- Array: literals, index/at, length, variadic push/unshift, pop, shift,
  splice, includes, indexOf, lastIndexOf, forEach, map, filter, reduce, some,
  every, find, findIndex, findLast, findLastIndex, reverse, default sort,
  fill, copyWithin, and concat over exact scalar/array alternatives; slice over closed Clone carriers and join over
  exact stringifiable carriers; Array.of over an exact selected element type,
  Array.from over strings, and Array.isArray over closed JsValue inputs;
  callbacks receive every declared argument,
  reduce supports both initial-value and first-present-element forms, and one
  identity-preserving `JsArray<T>` carrier represents dense and sparse arrays.
- String: length, toUpperCase, toLowerCase, includes, startsWith,
  endsWith, indexOf, lastIndexOf, slice, substring, substr, at, charAt,
  charCodeAt, codePointAt, repeat, padStart, padEnd, trim, trimStart,
  trimEnd, trimLeft, trimRight, toString, valueOf, concat, split, replace,
  replaceAll, search, and match; String.fromCharCode and
  String.fromCodePoint; String.matchAll call and fallibility lowering for
  constant patterns (consuming the returned match list is a blocked lane
  below). UTF-16 results that Rust strings cannot represent fail closed.
- RegExp: constant literals and new RegExp with literal arguments over the
  oracle-proven subset; test, replace, split, search, global match with
  null coalescing; regexp property reads; exec/match result consumption and
  matchAll result consumption through the exact selected match-array carrier.
- Math: all source-profile constants and functions, including trigonometric,
  hyperbolic, logarithmic, rounding, bit-conversion, variadic hypot/min/max,
  pow, and random operations; operations whose Rust primitives differ from
  JavaScript use exact runtime rows.
- Number.parseInt/parseFloat: exact prefix parsing; Number constants, valueOf,
  decimal toString, integral-radix toString, toFixed, toExponential,
  toPrecision, and non-coercive Number.isNaN/isFinite/isInteger/isSafeInteger
  predicates. Decimal conversion uses the
  ECMAScript Ryū algorithm; non-number unknown values and fractional
  non-decimal radix calls fail closed.
- JSON: parse, stringify, stringify with null replacer and closed numeric
  or string space, over the closed JsValue carrier.
- Map, Set: empty constructors, mutable and read-only carriers,
  get/set/has/delete/add/clear, size, keys/values/entries, direct iteration,
  callbacks with every declared arity, insertion order, and SameValueZero.
  Set algebra rows (union, intersection, difference, symmetricDifference,
  isSubsetOf, isSupersetOf, isDisjointFrom) are runtime-proven through the
  active source profile.
- Date: UTC carrier constructors, now, parse, UTC, getTime, valueOf,
  toISOString, toJSON, UTC getters.
- Console: console.log, console.error, console.warn, console.info, and
  console.debug with exact string, number,
  int32, and boolean arguments through one closed `JsValue` slice ABI;
  empty variadic calls pass an explicit empty slice.
- Node: path, os, fs, fs/promises (async signatures over synchronous file
  operations), process (cwd, exit, value exports, env with null-preserving
  reads, fallible execPath property, argv0, version, chdir, available and
  constrained memory, uptime, hrtime, and memoryUsage), Buffer, URL, URLSearchParams, legacy
  url.parse/format with the UrlObject carrier, crypto (randomUUID,
  randomBytes, createHash, createHmac), util (closed string helpers,
  inspect over closed JsValue, format with closed placeholders), and
  node:assert `ok` with optional string messages. The buffer extras are closed:
  Buffer copies mutate the
  selected target, slice/subarray values share backing storage, byte swaps
  preserve object identity, and the complete C#-visible numeric read/write
  matrix returns JavaScript numbers through one exact source ABI.
  The process identity and metrics lane preserves named/default module forms and
  map timing tuples and memory fields through closed native carriers.
- Error model, async/await, callbacks, tuples, fixed arrays, records,
  string-literal unions, discriminated object unions with exact selected
  narrowing evidence, generics, statics — see README.

## Hard-rejected by architecture

- Open reflection and dynamic member access; eval and embedded engines.
- Dynamic RegExp patterns and constructs outside the oracle subset (lazy
  quantifiers, backreferences, lookaround, named groups, word-boundary
  assertions, unicode property escapes, flags d s u v y).
- JSON replacer functions and custom toJSON dispatch.
- Process termination side effects beyond exit(code).

## Blocked by named external contracts

- localeCompare, locale case conversion, normalization: requires an ICU
  contract.
- Local-timezone Date lanes: requires a tzdata contract.
- streams and fs.watch, event subscriptions: requires stream and event
  carrier
  contracts.
- Fixed-size arrays beyond homogeneous tuples: requires source-core
  length facts.
- Object.keys/values/entries, Object.assign, Object.hasOwn:
  requires closed-shape reflection rows over the JsValue carrier.
- Console calls with open or structural object arguments: requires exact
  closed source-to-JsValue object conversion facts.
- Date UTC setters and local-time getters and setters: requires
  date-mutation and tzdata contracts.
- bare module aliases (fs as an alias of node:fs): requires a
  module-alias ownership contract.
- process stdio: requires exact stream and stdio carrier contracts.
