export const lastSelectedNode = (nodes, selected) => {
  if (Array.isArray(selected) && selected.length) {
    const path = selected[selected.length - 1];
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      if (nodes[index].path === path) return { index, item: nodes[index] };
    }
  }
  return { index: -1, item: [] };
};

export const lastSelectedNodeOfTableSort = (
  nodes,
  selected,
  reverse = false,
) => {
  if (Array.isArray(selected) && selected.length) {
    const paths = new Set(selected);
    for (
      let index = reverse ? 0 : nodes.length - 1;
      reverse ? index < nodes.length : index >= 0;
      index += reverse ? 1 : -1
    ) {
      if (paths.has(nodes[index].path)) return { index, item: nodes[index] };
    }
  }
  return { index: -1, item: [] };
};
