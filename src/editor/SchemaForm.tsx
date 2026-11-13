import { createContext, useContext, useState } from 'react';
import { AssetField } from './AssetPicker';
import {
  branchFor,
  defaultFor,
  discriminator,
  kindOf,
  labelFor,
  literalChoices,
  options,
  resolve,
  type Json,
  type JsonObject,
  type JsonSchema,
} from './jsonSchema';

export interface RefOption {
  value: string;
  label: string;
}

export interface FormContext {
  root: JsonSchema;
  /** Choices for fields that name another entry, such as "classId". Null for a free field. */
  refsFor: (fieldName: string) => RefOption[] | null;
  /** The library category to open for an asset field, or null if the field is not an asset. */
  assetCategoryFor: (fieldName: string) => string | null;
}

const Ctx = createContext<FormContext | null>(null);

function useForm(): FormContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('SchemaForm fields must be inside a SchemaForm.');
  return ctx;
}

const LONG_TEXT = new Set(['description', 'text', 'summary']);

interface FieldProps {
  name: string;
  schema: JsonSchema;
  value: Json | undefined;
  required: boolean;
  onChange: (value: Json | undefined) => void;
}

function Field({ name, schema: raw, value, required, onChange }: FieldProps) {
  const { root, refsFor, assetCategoryFor } = useForm();
  const schema = resolve(raw, root);
  const label = labelFor(name);

  const asset = assetCategoryFor(name);
  if (asset !== null && kindOf(schema) === 'string') {
    return (
      <div className="form-field">
        <span className="form-label">{label}</span>
        <AssetField
          value={typeof value === 'string' && value ? value : undefined}
          category={asset}
          allowClear={!required}
          onChange={(v) => onChange(v)}
        />
      </div>
    );
  }

  const refs = refsFor(name);
  if (refs && kindOf(schema) === 'string') {
    return (
      <label className="form-field">
        <span className="form-label">{label}</span>
        <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
          {(!required || !value) && <option value="">{required ? 'Choose…' : 'None'}</option>}
          {refs.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
          {typeof value === 'string' && value && !refs.some((r) => r.value === value) && (
            <option value={value}>{value} (missing)</option>
          )}
        </select>
      </label>
    );
  }

  const literals = literalChoices(schema, root);
  if (literals) {
    return (
      <label className="form-field">
        <span className="form-label">{label}</span>
        <select
          value={JSON.stringify(value ?? literals[0])}
          onChange={(e) => onChange(JSON.parse(e.target.value) as Json)}
        >
          {literals.map((l) => (
            <option key={JSON.stringify(l)} value={JSON.stringify(l)}>
              {String(l)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (options(schema)) {
    const key = discriminator(schema, root);
    if (key) return <UnionField name={name} schema={schema} discriminatorKey={key} value={value} onChange={onChange} />;
    return <JsonField name={name} value={value} onChange={onChange} />;
  }

  if (schema.enum) {
    return (
      <label className="form-field">
        <span className="form-label">{label}</span>
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {schema.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  switch (kindOf(schema)) {
    case 'object':
      return (
        <fieldset className="form-group">
          <legend>{label}</legend>
          <ObjectFields schema={schema} value={(value as JsonObject) ?? {}} onChange={onChange} />
        </fieldset>
      );
    case 'array':
      return <ArrayField name={name} schema={schema} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    case 'boolean':
      return (
        <label className="form-field form-check">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="form-label">{label}</span>
        </label>
      );
    case 'number':
    case 'integer':
      return (
        <label className="form-field">
          <span className="form-label">{label}</span>
          <input
            type="number"
            step={kindOf(schema) === 'integer' ? 1 : 'any'}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => {
              const n = e.target.value === '' ? undefined : Number(e.target.value);
              onChange(n === undefined && required ? 0 : n);
            }}
          />
        </label>
      );
    case 'string':
      return (
        <label className="form-field">
          <span className="form-label">{label}</span>
          {LONG_TEXT.has(name) ? (
            <textarea rows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
          ) : (
            <input type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
          )}
        </label>
      );
    default:
      return <JsonField name={name} value={value} onChange={onChange} />;
  }
}

/** A union of object shapes picked by one field, such as an item's "kind" or an effect's "type". */
function UnionField({
  name,
  schema,
  discriminatorKey,
  value,
  onChange,
  bare,
}: {
  name: string;
  schema: JsonSchema;
  discriminatorKey: string;
  value: Json | undefined;
  onChange: (value: Json) => void;
  bare?: boolean;
}) {
  const { root } = useForm();
  const current = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as JsonObject;
  const opts = options(schema)!.map((o) => resolve(o, root));
  const choices = opts.map((o) => resolve(o.properties![discriminatorKey]!, root).const as string);
  const active = (current[discriminatorKey] as string | undefined) ?? choices[0]!;
  const branch = branchFor(schema, root, discriminatorKey, active) ?? opts[0]!;

  const switchTo = (next: string) => {
    const nextBranch = branchFor(schema, root, discriminatorKey, next)!;
    const fresh = defaultFor(nextBranch, root) as JsonObject;
    // Keep the fields both shapes share, such as id, name and icon.
    for (const [k, v] of Object.entries(current)) {
      if (k !== discriminatorKey && nextBranch.properties?.[k]) fresh[k] = v;
    }
    onChange(fresh);
  };

  const body = (
    <>
      <label className="form-field">
        <span className="form-label">{labelFor(discriminatorKey)}</span>
        <select value={active} onChange={(e) => switchTo(e.target.value)}>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <ObjectFields schema={branch} value={current} onChange={onChange} skip={discriminatorKey} />
    </>
  );

  if (bare) return body;
  return (
    <fieldset className="form-group">
      <legend>{labelFor(name)}</legend>
      {body}
    </fieldset>
  );
}

function ObjectFields({
  schema,
  value,
  onChange,
  skip,
}: {
  schema: JsonSchema;
  value: JsonObject;
  onChange: (value: JsonObject) => void;
  skip?: string;
}) {
  const { root } = useForm();
  const required = new Set(schema.required ?? []);
  const keys = Object.keys(schema.properties ?? {}).filter((k) => k !== skip);

  const set = (key: string, next: Json | undefined) => {
    const copy: JsonObject = { ...value };
    if (next === undefined) delete copy[key];
    else copy[key] = next;
    onChange(copy);
  };

  return (
    <div className="form-fields">
      {keys.map((key) => {
        const prop = schema.properties![key]!;
        const isRequired = required.has(key);
        const present = key in value;
        const kind = kindOf(resolve(prop, root));
        const isComplex = kind === 'object' || kind === 'array' || !!options(resolve(prop, root));

        if (!isRequired && !present && isComplex) {
          return (
            <button key={key} type="button" className="add-optional" onClick={() => set(key, defaultFor(prop, root))}>
              + Add {labelFor(key).toLowerCase()}
            </button>
          );
        }
        return (
          <div key={key} className="form-row">
            <Field name={key} schema={prop} value={value[key]} required={isRequired} onChange={(v) => set(key, v)} />
            {!isRequired && present && isComplex && (
              <button type="button" className="remove-optional" onClick={() => set(key, undefined)}>
                Remove
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ArrayField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  value: Json[];
  onChange: (value: Json[]) => void;
}) {
  const { root } = useForm();
  const itemSchema = schema.items ?? {};
  const itemName = name.endsWith('Ids') ? name.slice(0, -1) : name.replace(/s$/, '');

  return (
    <fieldset className="form-group">
      <legend>
        {labelFor(name)} <span className="dim">({value.length})</span>
      </legend>
      {value.map((item, i) => (
        <div key={i} className="array-item">
          <Field
            name={itemName}
            schema={itemSchema}
            value={item}
            required
            onChange={(next) => onChange(value.map((v, j) => (j === i ? (next ?? null) : v)))}
          />
          <button type="button" className="remove-optional" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="add-optional" onClick={() => onChange([...value, defaultFor(itemSchema, root)])}>
        + Add {labelFor(itemName).toLowerCase()}
      </button>
    </fieldset>
  );
}

/** Fallback for shapes the form does not know: edit the value as JSON. */
function JsonField({ name, value, onChange }: { name: string; value: Json | undefined; onChange: (v: Json) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="form-field">
      <span className="form-label">{labelFor(name)} (JSON)</span>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value) as Json);
            setError(null);
          } catch {
            setError('Not valid JSON yet.');
          }
        }}
      />
      {error && <span className="error">{error}</span>}
    </label>
  );
}

interface SchemaFormProps extends FormContext {
  value: JsonObject;
  onChange: (value: JsonObject) => void;
}

/** A form for one content entry, built from its collection's schema. */
export function SchemaForm({ root, refsFor, assetCategoryFor, value, onChange }: SchemaFormProps) {
  const schema = resolve(root, root);
  const key = options(schema) ? discriminator(schema, root) : null;
  return (
    <Ctx.Provider value={{ root, refsFor, assetCategoryFor }}>
      <div className="schema-form">
        {key ? (
          <UnionField
            name="entry"
            schema={schema}
            discriminatorKey={key}
            value={value}
            onChange={(v) => onChange(v as JsonObject)}
            bare
          />
        ) : (
          <ObjectFields schema={schema} value={value} onChange={onChange} />
        )}
      </div>
    </Ctx.Provider>
  );
}
