export function checkScript(schema, value) {
  const problems = [];
  const fixed = walk(schema, value, "script", problems);
  if (problems.length) throw new Error(`Script JSON isn't complete: ${problems.slice(0, 6).join("; ")}`);
  return fixed;
}

function walk(schema, value, where, problems) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${where} should be an object`);
      return value;
    }
    for (const key of schema.required ?? []) {
      const sub = schema.properties[key];
      if (value[key] == null) {
        if (sub.type === "array") value[key] = [];
        else if (sub.type === "string" && sub.optionalText) value[key] = "";
        else if (sub.enum) value[key] = sub.enum[0];
        else if (sub.type === "object" && (sub.required ?? []).every((k) => sub.properties[k].enum || sub.properties[k].type === "array" || sub.properties[k].optionalText)) value[key] = {};
        else if (sub.optional) continue;
        else {
          problems.push(`${where}.${key} is missing`);
          continue;
        }
      }
      value[key] = walk(sub, value[key], `${where}.${key}`, problems);
    }
    return value;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      problems.push(`${where} should be a list`);
      return value;
    }
    if (schema.minItems && value.length < schema.minItems) problems.push(`${where} needs at least ${schema.minItems} items`);
    return value.map((item, i) => walk(schema.items, item, `${where}[${i + 1}]`, problems));
  }
  if (schema.enum && !schema.enum.includes(value)) return schema.enum[0];
  return value;
}

export function publicSchema(schema) {
  return JSON.parse(
    JSON.stringify(schema, (key, val) => (key === "optionalText" || key === "minItems" || key === "optional" ? undefined : val)),
  );
}
