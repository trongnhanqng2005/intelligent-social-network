import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import yaml from 'js-yaml';

test('Post write schemas apply the 2,000-code-point maximum after NFC normalization', async () => {
  const source = await readFile(new URL('../../docs/api/openapi.yaml', import.meta.url), 'utf8');
  const document = yaml.load(source);
  const schemas = document.components.schemas;

  for (const name of ['CreatePost', 'UpdatePost']) {
    const content = schemas[name].properties.content;
    assert.equal(content.type, 'string');
    assert.equal(Object.hasOwn(content, 'maxLength'), false);
    assert.match(content.description, /NFC-normalized/u);
    assert.match(content.description, /2,000-code-point maximum applies after normalization/u);
  }

  assert.equal(schemas.Post.properties.content.maxLength, 2000);
});
