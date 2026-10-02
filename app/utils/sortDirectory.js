import { isFloat, isInt, isNumber } from './funcs';
import { pathInfo } from './files';

const sortKey = ({ value, orderBy }) => {
  if (orderBy === 'size' && value.isFolder) {
    return 0;
  }

  const item = value[orderBy];
  let _primer = null;

  if (isNumber(item)) {
    if (isInt(item)) {
      _primer = parseInt(item, 10);
    } else if (isFloat(item)) {
      _primer = parseFloat(item);
    }
  }

  if (_primer === null) {
    if (!value.isFolder) {
      const _pathInfo = pathInfo(item, value.isFolder);

      _primer = _pathInfo.name.toLowerCase();
    } else {
      _primer = item.toLowerCase();
    }
  }

  return _primer;
};

export const sortDirectory = ({
  nodes,
  order,
  orderBy,
  showDirectoriesFirst,
}) => {
  if (!nodes?.length) return [];
  // Compute expensive filename parsing once per node, instead of each comparison.
  let result =
    nodes.length === 1
      ? [...nodes]
      : nodes
          .map((node) => ({ node, key: sortKey({ value: node, orderBy }) }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          .map(({ node }) => node);
  if (order !== 'asc') result.reverse();
  if (showDirectoriesFirst) {
    const folders = [];
    const files = [];
    for (const node of result) (node.isFolder ? folders : files).push(node);
    result = folders.concat(files);
  }
  return result;
};
