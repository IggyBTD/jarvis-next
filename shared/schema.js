// A small JSON-Schema subset, enough for config files and action parameters:
// type (string|number|integer|boolean|object|array|null, or an array of them), enum, const, properties, required,
// additionalProperties (false | schema), items, minItems, maxItems, minimum, maximum, minLength, maxLength, pattern,
// anyOf. Own-property checks use Object.hasOwn so "__proto__" and "constructor" keys are never mistaken for data.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

export function validate(schema, value, path = '$') {
  const errors = [];
  const err = (msg) => errors.push(`${path}: ${msg}`);
  if (!schema || schema === true) return errors;

  if (schema.anyOf) {
    const tries = schema.anyOf.map((s) => validate(s, value, path));
    if (!tries.some((t) => t.length === 0)) err(`matches none of the allowed shapes (${tries.map((t) => t[0]).join(' | ')})`);
    return errors;
  }
  if (schema.const !== undefined && value !== schema.const) { err(`must be ${JSON.stringify(schema.const)}`); return errors; }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) { err(`must be ${types.join(' or ')}, got ${typeOf(value)}`); return errors; }
  }
  if (schema.enum && !schema.enum.includes(value)) err(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) err(`must have at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) err(`must have at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) err(`must match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) err(`must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) err(`must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) err(`missing required property "${key}"`);
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(props, key)) errors.push(...validate(props[key], value[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) err(`unknown property "${key}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, value[key], `${path}.${key}`));
    }
  }
  return errors;
}

export const isValid = (schema, value) => validate(schema, value).length === 0;
