import './guard';
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocument } from 'htmlparser2';
import PrivacyPolicyContent from '../../shared/privacyPolicy';

const options = {
  appName: 'OpenMTP',
  authorName: 'Ganesh Rathinavel',
  authorEmail: 'ganeshrvel@outlook.com',
  contactUrl: 'https://github.com/ganeshrvel',
  profileDir: '$HOME/Library/Application Support/io.ganeshrvel.openmtp',
  website: true,
};

// Captured from the former website document. Preserve text, element order,
// paragraph/list structure and URLs while ignoring HTML formatting whitespace.
function normalize(node) {
  if (node.type === 'text') return node.data.replace(/\s+/g, ' ').trim();
  if (node.type === 'comment') return '';
  return [
    node.name || 'root',
    node.attribs || {},
    ...(node.children || []).map(normalize).filter((child) => child !== ''),
  ];
}

test('shared policy preserves the published website content and links', () => {
  const html = renderToStaticMarkup(
    createElement(PrivacyPolicyContent, options),
  );
  const hash = createHash('sha256')
    .update(JSON.stringify(normalize(parseDocument(html))))
    .digest('hex');
  expect(hash).toBe(
    'fd3821975ba27cd2f1ec39ebf35717e89c3108a85c837d5bc262e93852120335',
  );
  expect(html).toContain('Personal Data</span> <span>While');
});

test('desktop supplies native links and escapes dynamic profile data', () => {
  const links = [];
  const Link = ({ href, children }) => {
    links.push(href);
    return createElement('a', null, children);
  };
  const html = renderToStaticMarkup(
    createElement(PrivacyPolicyContent, {
      ...options,
      website: false,
      profileDir: '/Users/<script>alert("x")</script>',
      contactUrl: 'https://github.com/aaditagrawal/openmtp',
      Link,
    }),
  );
  expect(links).toEqual([
    'https://policies.google.com/privacy?hl=en',
    'https://mixpanel.com/legal/privacy-policy/',
    'https://sentry.io/privacy/',
    'https://help.github.com/articles/github-privacy-statement/',
    'mailto:ganeshrvel@outlook.com',
    'https://github.com/aaditagrawal/openmtp',
  ]);
  expect(html).not.toContain('href=');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&quot;google-ga&quot;');
  expect(html).toContain(
    '<p><span>LocalStorage files we used in the app:</span></p>',
  );
});
