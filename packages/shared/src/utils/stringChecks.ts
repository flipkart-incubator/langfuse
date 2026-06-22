export function getIsCharOrUnderscore(value: string): boolean {
  const charOrUnderscore = /^[\p{L}\p{N}_]+$/u;

  return charOrUnderscore.test(value);
}

// Regex for valid variable names (unicode letters, underscores, starting with letter)
export const VARIABLE_REGEX = /^\p{L}[\p{L}\p{N}_]*$/u;

// Regex to find variables in mustache syntax
export const MUSTACHE_REGEX = /{{([^{}]*)}}+/g;

// Regex to find multiline variables
export const MULTILINE_VARIABLE_REGEX = /{{[^}]*\n[^}]*}}/g;

// Regex to find unclosed variables
export const UNCLOSED_VARIABLE_REGEX = /{{(?![^{]*}})/g;

export function isValidVariableName(variable: string): boolean {
  return VARIABLE_REGEX.test(variable);
}

export function extractVariables(mustacheString: string): string[] {
  const matches = Array.from(mustacheString.matchAll(MUSTACHE_REGEX))
    .map((match) => match[1])
    .filter(isValidVariableName);

  return [...new Set(matches)];
}

// Nunjucks built-in globals and keywords to exclude from variable extraction.
// Mirrors the NUNJUCKS_BUILTINS set in prompt-compiler/index.ts but lives in a
// client-safe module so it can be imported by frontend code.
const NUNJUCKS_BUILTINS_LITE = new Set([
  "range",
  "dict",
  "joiner",
  "cycler",
  "true",
  "false",
  "null",
  "undefined",
  "loop",
  "not",
  "and",
  "or",
  "in",
  "is",
  "if",
  "else",
  "elif",
  "endif",
  "for",
  "endfor",
  "block",
  "macro",
  "call",
  "filter",
  "set",
  "include",
  "import",
  "from",
  "extends",
  "super",
  "with",
  "without",
  "context",
  "endblock",
  "endmacro",
  "endcall",
  "raw",
  "endraw",
]);

/**
 * Client-safe Jinja2/Nunjucks variable extractor. Mirrors the regex logic from
 * `extractTemplateVariables` in `prompt-compiler/index.ts` but avoids importing
 * nunjucks (a Node-only dependency).
 *
 * Handles {{ expr }}, {% if/elif var %}, {% for alias in list %}, and {% set x = var %}.
 */
export function extractTemplateVariablesLite(template: string): string[] {
  const variables = new Set<string>();
  const loopAliases = new Set<string>();

  // Extract loop aliases from {% for alias in list %} blocks
  const forRegex = /{%-?\s*for\s+(\w+)\s+in\s+(\w+)/g;
  let forMatch;
  while ((forMatch = forRegex.exec(template)) !== null) {
    loopAliases.add(forMatch[1]); // alias — exclude
    const listVar = forMatch[2];
    if (listVar && !NUNJUCKS_BUILTINS_LITE.has(listVar)) {
      variables.add(listVar); // list variable — include
    }
  }

  // Extract {{ expr }} output expressions — take root identifier only
  const outputRegex = /{{\s*([\w]+)/g;
  let outputMatch;
  while ((outputMatch = outputRegex.exec(template)) !== null) {
    const name = outputMatch[1];
    if (name && !NUNJUCKS_BUILTINS_LITE.has(name) && !loopAliases.has(name)) {
      variables.add(name);
    }
  }

  // Extract {% if varName %} / {% elif varName %} conditions — root identifier
  const condRegex = /{%-?\s*(?:if|elif)\s+([\w]+)/g;
  let condMatch;
  while ((condMatch = condRegex.exec(template)) !== null) {
    const name = condMatch[1];
    if (name && !NUNJUCKS_BUILTINS_LITE.has(name) && !loopAliases.has(name)) {
      variables.add(name);
    }
  }

  // Catch {% set x = var %} — include the RHS variable
  const setRegex = /{%-?\s*set\s+\w+\s*=\s*([\w]+)/g;
  let setMatch;
  while ((setMatch = setRegex.exec(template)) !== null) {
    const name = setMatch[1];
    if (name && !NUNJUCKS_BUILTINS_LITE.has(name) && !loopAliases.has(name)) {
      variables.add(name);
    }
  }

  return Array.from(variables).sort();
}

export function stringifyValue(value: unknown) {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return value.toString();
    case "boolean":
      return value.toString();
    default:
      return JSON.stringify(value);
  }
}
