import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Exercise the real input's handlers across renders, including parent echoes.
const require = createRequire(import.meta.url);
let state;
const code = ts.transpileModule(readFileSync(new URL('../components/CompDecimalInput.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => name === 'react' ? {
  useState: () => [state ?? null, next => { state = next; }],
} : require(name), module, module.exports);
const Input = module.exports.default;
let value = null;
const render = () => Input({ value, onChange: next => { value = next; } });
for (const text of ['1', '1.', '1.2', '1.20']) {
  render().props.onChange({ target: { value: text } });
  assert.equal(render().props.value, text);
}
assert.equal(value, 1.2);
for (const text of ['', '.', '.9', '.95']) {
  render().props.onChange({ target: { value: text } });
  assert.equal(render().props.value, text);
}
assert.equal(value, .95);
render().props.onChange({ target: { value: '$1.20' } });
assert.equal(value, 1.2);
render().props.onChange({ target: { value: '1..20' } });
assert.equal(value, 1.2);
value = 2.35;
assert.equal(render().props.value, '2.35');
console.log('Decimal entry: typing 1.20 and .95, pasted currency, invalid input, and external updates passed');
