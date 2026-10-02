import './guard';
import { expect, test } from 'bun:test';
import { parse } from 'node:path';
import {
  lastSelectedNode,
  lastSelectedNodeOfTableSort,
} from '../../app/utils/selection';
import { sortDirectory } from '../../app/utils/sortDirectory';

// Independent reference for the previous nested selection scans.
function referenceSelection(nodes, selected, reverse, lastOnly = false) {
  let result = { index: -1, item: [] };
  nodes.forEach((item, index) => {
    if (!Array.isArray(selected) || !selected.length) return;
    const paths = lastOnly ? selected.slice(-1) : selected;
    for (const path of paths) {
      if (path === item.path && (!reverse || result.index < 0))
        result = { index, item };
    }
  });
  return result;
}

test('selection endpoints preserve ordering, duplicates and absent selections', () => {
  const nodes = Array.from({ length: 137 }, (_, i) => ({
    path: `/f${i % 43}`,
  }));
  for (const selected of [
    null,
    undefined,
    {},
    [],
    ['/absent'],
    ['/f3'],
    ['/f21', '/f3', '/f21'],
    nodes.map((n) => n.path),
  ]) {
    expect(lastSelectedNode(nodes, selected)).toEqual(
      referenceSelection(nodes, selected, false, true),
    );
    for (const reverse of [false, true]) {
      expect(lastSelectedNodeOfTableSort(nodes, selected, reverse)).toEqual(
        referenceSelection(nodes, selected, reverse),
      );
      expect(lastSelectedNodeOfTableSort([], selected, reverse)).toEqual({
        index: -1,
        item: [],
      });
    }
  }
});

function referenceSort(nodes, order, orderBy, directoriesFirst) {
  const key = (node) => {
    if (orderBy === 'size' && node.isFolder) return 0;
    const value = node[orderBy];
    if (typeof value === 'number')
      return value % 1 === 0 ? parseInt(value, 10) : parseFloat(value);
    return (node.isFolder ? value : parse(value).name).toLowerCase();
  };
  let result = [...nodes].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
  if (order !== 'asc') result.reverse();
  if (directoriesFirst)
    result = result
      .filter((n) => n.isFolder)
      .concat(result.filter((n) => !n.isFolder));
  return result;
}

test('cached sort keys preserve ascending/descending ties, file stems and folder grouping', () => {
  const nodes = Array.from({ length: 200 }, (_, i) => ({
    path: `/fixture/${i}`,
    name: [
      'alpha.txt',
      'ALPHA.jpg',
      '.hidden',
      '文档',
      'zulu.tar.gz',
      'folder',
    ][i % 6],
    size: i % 9 ? (i % 17) + 0.25 : 0,
    modifiedAt: 1000 - (i % 11),
    isFolder: i % 7 === 0,
  }));
  for (const orderBy of ['name', 'size', 'modifiedAt']) {
    for (const order of ['asc', 'desc']) {
      for (const showDirectoriesFirst of [false, true]) {
        const before = [...nodes];
        expect(
          sortDirectory({ nodes, order, orderBy, showDirectoriesFirst }),
        ).toEqual(referenceSort(nodes, order, orderBy, showDirectoriesFirst));
        expect(nodes).toEqual(before);
      }
    }
  }
  expect(sortDirectory({ nodes: [] })).toEqual([]);
  expect(sortDirectory({})).toEqual([]);
  const singleton = [{}];
  expect(sortDirectory({ nodes: singleton })).toEqual(singleton);
});
