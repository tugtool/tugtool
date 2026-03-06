/**
 * property-store.ts -- PropertyStore class, PropertySchema, PropertyDescriptor,
 * PropertyChange, and PropertyChangeListener types.
 *
 * Provides a typed key-path store with get/set/observe/schema semantics.
 * Cards expose inspectable properties via PropertyStore. Inspectors discover,
 * read, write, and observe properties without importing card internals.
 *
 * PropertyStore.observe() is directly usable as useSyncExternalStore's
 * subscribe argument: `(callback: () => void) => () => void`.
 *
 * Design decisions:
 *   [D02] Store owns values with optional callbacks
 *   [D03] Observer-side circular guard
 *   [D05] Per-path observe for useSyncExternalStore
 *
 * Spec S01, Spec S02, Spec S03
 *
 * See also: tugplan-tugways-phase-5d4-observable-properties.md
 */

// ---------------------------------------------------------------------------
// PropertyDescriptor and PropertySchema (Spec S02)
// ---------------------------------------------------------------------------

/**
 * Describes a single property in a PropertyStore schema.
 *
 * Spec S02 (#s02-property-schema)
 */
export interface PropertyDescriptor {
  /** Dot-separated key path (e.g., "style.backgroundColor"). */
  path: string;
  /** Value type for the property. */
  type: "string" | "number" | "boolean" | "color" | "point" | "enum";
  /** Human-readable label for inspector UI. */
  label: string;
  /** Valid values for enum-typed properties. Required when type === "enum". */
  enumValues?: string[];
  /** Minimum value for number-typed properties. Values are clamped, not rejected. */
  min?: number;
  /** Maximum value for number-typed properties. Values are clamped, not rejected. */
  max?: number;
  /** When true, set() throws if this property is written. Default: false. */
  readOnly?: boolean;
}

/**
 * The schema for a PropertyStore: the full set of available paths and their
 * type/constraint metadata.
 *
 * Spec S02 (#s02-property-schema)
 */
export interface PropertySchema {
  paths: PropertyDescriptor[];
}

// ---------------------------------------------------------------------------
// PropertyChange and PropertyChangeListener (Spec S03)
// ---------------------------------------------------------------------------

/**
 * A change record emitted to observers whenever a property is written.
 *
 * The `source` field enables observer-side circular guard: observers that
 * originated the change can skip re-dispatch. [D03]
 *
 * Spec S03 (#s03-property-change)
 */
export interface PropertyChange {
  /** The path that changed. */
  path: string;
  /** The value before the change. */
  oldValue: unknown;
  /** The value after the change. */
  newValue: unknown;
  /**
   * Identifies who made the change (e.g., "inspector", "content").
   * Observers check this to avoid circular re-dispatch. [D03]
   */
  source: string;
  /**
   * Optional transaction ID for future live-preview integration.
   * Provided when the change is part of a MutationTransaction.
   */
  transactionId?: string;
}

/**
 * Listener that receives detailed change records from PropertyStore.observe().
 *
 * JavaScript allows calling a zero-arity `() => void` function with extra
 * arguments, so plain callbacks can also be used as the listener argument --
 * they simply ignore the PropertyChange record. This makes observe() directly
 * usable as useSyncExternalStore's subscribe function. [D05]
 *
 * Spec S03 (#s03-property-change)
 */
export type PropertyChangeListener = (change: PropertyChange) => void;

// ---------------------------------------------------------------------------
// PropertyStore (Spec S01)
// ---------------------------------------------------------------------------

/**
 * Options for constructing a PropertyStore.
 *
 * [D02] Store owns values with optional callbacks
 */
export interface PropertyStoreOptions {
  /** The property schema describing all available paths. */
  schema: PropertyDescriptor[];
  /** Initial values for each path. Paths missing from this map default to undefined. */
  initialValues: Record<string, unknown>;
  /**
   * Optional override for get(). When provided, get() calls onGet instead of
   * reading from the internal map. Used for bridging to external state (DOM,
   * feed data, tugbank).
   */
  onGet?: (path: string) => unknown;
  /**
   * Optional side-effect hook for set(). When provided, onSet is called after
   * the internal map write and observer notification. Used for bridging writes
   * to external systems.
   */
  onSet?: (path: string, value: unknown, source: string) => void;
}

/**
 * Typed key-path property store with get/set/observe/schema semantics.
 *
 * Cards register a PropertyStore instance via usePropertyStore() so that
 * inspectors can discover, read, write, and observe properties without
 * importing card internals.
 *
 * Key behaviors:
 * - get(path) returns stable references for unchanged values (Risk R01 mitigation)
 * - set(path, value, source) validates constraints and fires observers
 * - observe(path, listener) returns an unsubscribe function; listeners receive
 *   the full PropertyChange record, but plain `() => void` callbacks are also
 *   accepted and simply ignore the argument (JavaScript allows this) [D05]
 * - getSchema() returns the PropertySchema for introspection
 *
 * [D02] Store owns values with optional callbacks
 * [D03] Observer-side circular guard
 * [D05] Per-path observe for useSyncExternalStore
 * Spec S01 (#s01-property-store-api)
 */
export class PropertyStore {
  private readonly _schema: PropertySchema;
  private readonly _values: Map<string, unknown>;
  private readonly _listeners: Map<string, Set<Function>>;
  private readonly _onGet?: (path: string) => unknown;
  private readonly _onSet?: (path: string, value: unknown, source: string) => void;

  constructor(options: PropertyStoreOptions) {
    this._schema = { paths: [...options.schema] };
    this._values = new Map();
    this._listeners = new Map();
    this._onGet = options.onGet;
    this._onSet = options.onSet;

    // Initialize values from initialValues
    for (const descriptor of options.schema) {
      const initial = options.initialValues[descriptor.path];
      this._values.set(descriptor.path, initial);
    }
  }

  /**
   * Return the current value for the given path.
   *
   * Throws if the path is not in the schema. Returns stable references for
   * unchanged values -- the same reference is returned on repeated calls if
   * the value has not been written since the last get() (Risk R01 mitigation).
   *
   * If an onGet callback is provided, it overrides the internal map read.
   *
   * Spec S01 (#s01-property-store-api)
   */
  get(path: string): unknown {
    this._requireValidPath(path);
    if (this._onGet) {
      return this._onGet(path);
    }
    return this._values.get(path);
  }

  /**
   * Write a new value for the given path and notify all observers.
   *
   * Validation:
   * - Throws if the path is not in the schema.
   * - Throws if the property is readOnly.
   * - Throws if the property is enum-typed and value is not in enumValues.
   * - Clamps number values to [min, max] if min/max are defined (does not throw).
   *
   * Fires all observers for the path with a PropertyChange record including
   * the source string. [D03] Observers are responsible for checking source
   * to avoid circular re-dispatch.
   *
   * If an onSet callback is provided, it is called after the internal write
   * and observer notification.
   *
   * Spec S01 (#s01-property-store-api)
   */
  set(path: string, value: unknown, source: string): void {
    const descriptor = this._requireValidPath(path);

    if (descriptor.readOnly) {
      throw new Error(
        `PropertyStore.set: property "${path}" is readOnly and cannot be written.`
      );
    }

    // Validate and coerce value based on type constraints
    const coercedValue = this._validateAndCoerce(descriptor, value);

    const oldValue = this._values.get(path);
    this._values.set(path, coercedValue);

    // Fire all observers for this path with the change record
    const change: PropertyChange = {
      path,
      oldValue,
      newValue: coercedValue,
      source,
    };

    const listeners = this._listeners.get(path);
    if (listeners) {
      for (const listener of listeners) {
        listener(change);
      }
    }

    // Call optional onSet side-effect after write and notification
    this._onSet?.(path, coercedValue, source);
  }

  /**
   * Subscribe to changes on a single path.
   *
   * Accepts both PropertyChangeListener (receives the full PropertyChange
   * record) and plain `() => void` callbacks (which ignore the argument).
   * This dual acceptance makes observe() directly usable as
   * useSyncExternalStore's subscribe argument:
   *
   * ```ts
   * useSyncExternalStore(
   *   cb => store.observe(path, cb),
   *   () => store.get(path)
   * )
   * ```
   *
   * Returns an unsubscribe function. After calling unsubscribe, the listener
   * no longer fires.
   *
   * Throws if the path is not in the schema.
   *
   * [D05] Per-path observe for useSyncExternalStore
   * Spec S01 (#s01-property-store-api)
   */
  observe(path: string, listener: PropertyChangeListener | (() => void)): () => void {
    this._requireValidPath(path);

    let listeners = this._listeners.get(path);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(path, listeners);
    }
    listeners.add(listener);

    return () => {
      const set = this._listeners.get(path);
      if (set) {
        set.delete(listener);
      }
    };
  }

  /**
   * Return the PropertySchema describing all available paths and their
   * types and constraints.
   *
   * Spec S01 (#s01-property-store-api)
   */
  getSchema(): PropertySchema {
    return this._schema;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate that the given path is in the schema. Returns the descriptor.
   * Throws with a clear message if the path is not found.
   */
  private _requireValidPath(path: string): PropertyDescriptor {
    const descriptor = this._schema.paths.find((d) => d.path === path);
    if (!descriptor) {
      const valid = this._schema.paths.map((d) => d.path).join(", ");
      throw new Error(
        `PropertyStore: unknown path "${path}". Valid paths: [${valid}]`
      );
    }
    return descriptor;
  }

  /**
   * Validate type constraints and coerce value if needed.
   *
   * Number values: clamped to [min, max] if defined (not rejected).
   * Enum values: throws if value is not in enumValues.
   * All other types: passed through as-is (no runtime type checking beyond enum).
   */
  private _validateAndCoerce(descriptor: PropertyDescriptor, value: unknown): unknown {
    if (descriptor.type === "number") {
      const num = value as number;
      let coerced = num;
      if (descriptor.min !== undefined && coerced < descriptor.min) {
        coerced = descriptor.min;
      }
      if (descriptor.max !== undefined && coerced > descriptor.max) {
        coerced = descriptor.max;
      }
      return coerced;
    }

    if (descriptor.type === "enum") {
      const enumValues = descriptor.enumValues ?? [];
      if (!enumValues.includes(value as string)) {
        throw new Error(
          `PropertyStore.set: invalid enum value "${String(value)}" for path "${descriptor.path}". ` +
          `Valid values: [${enumValues.join(", ")}]`
        );
      }
      return value;
    }

    return value;
  }
}
