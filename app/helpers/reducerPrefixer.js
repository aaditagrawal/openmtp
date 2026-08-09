export default (prefix, typesList) => {
  return typesList.reduce((result, value) => {
    // oxlint-disable-next-line no-param-reassign
    result[value] = `${prefix}/${value}`;

    return result;
  }, {});
};
