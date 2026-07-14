export function closedMetadataEquals(left: unknown, right: unknown): boolean {
  if (!isClosedMetadata(left) || !isClosedMetadata(right)) {
    return false;
  }
  return closedMetadataEqualsValidated(left, right);
}

function closedMetadataEqualsValidated(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => closedMetadataEqualsValidated(entry, right[index]));
  }
  if (!isMetadataRecord(left) || !isMetadataRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && closedMetadataEqualsValidated(left[key], right[key]));
}

export function snapshotClosedMetadata<T>(value: T): T {
  return cloneClosedMetadata(value, new WeakSet<object>(), "metadata") as T;
}

export function isClosedMetadata(value: unknown): boolean {
  try {
    return validateClosedMetadata(value, new WeakSet<object>());
  } catch {
    return false;
  }
}

function validateClosedMetadata(value: unknown, active: WeakSet<object>): boolean {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || active.has(value)) {
    return false;
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return isDenseDataArray(value) && value.every((entry) => validateClosedMetadata(entry, active));
    }
    if (!isMetadataRecord(value)) {
      return false;
    }
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined &&
        validateClosedMetadata(descriptor.value, active);
    });
  } finally {
    active.delete(value);
  }
}

function cloneClosedMetadata(value: unknown, active: WeakSet<object>, path: string): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} contains unsupported '${typeof value}' metadata`);
  }
  if (active.has(value)) {
    throw new Error(`${path} contains a cycle`);
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (!isDenseDataArray(value)) {
        throw new Error(`${path} contains a sparse, accessor-backed, or custom-property array`);
      }
      const clone = value.map((entry, index) => cloneClosedMetadata(entry, active, `${path}[${index}]`));
      return Object.freeze(clone);
    }
    if (!isMetadataRecord(value)) {
      throw new Error(`${path} contains a non-plain metadata object`);
    }
    const clone: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new Error(`${path} contains a symbol-keyed field`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new Error(`${path}.${key} is not a data field`);
      }
      clone[key] = cloneClosedMetadata(descriptor.value, active, `${path}.${key}`);
    }
    return Object.freeze(clone);
  } finally {
    active.delete(value);
  }
}

export function isDenseDataArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) =>
    key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor)) {
      return false;
    }
  }
  return true;
}

function isMetadataRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
