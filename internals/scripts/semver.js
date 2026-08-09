exports.semverSatisfies = (version, range) => {
  const [gtOp, gtVersion] = gtSemver(range);
  const [ltOp, ltVersion] = ltSemver(range);
  const gtComparison = compareSemver(version, gtVersion);
  const ltComparison = compareSemver(version, ltVersion);

  if (gtComparison < 0 || (gtComparison === 0 && gtOp === '>')) {
    return false;
  }

  if (ltComparison > 0 || (ltComparison === 0 && ltOp === '<')) {
    return false;
  }

  return true;
};

const gtSemver = (range) => {
  const gtPattern = /(>=?)\s*(\d+(?:\.\d+(?:\.\d+)?)?)/.exec(range);

  return gtPattern ? [gtPattern[1], gtPattern[2]] : ['>=', '0.0.0'];
};

const ltSemver = (range) => {
  const ltPattern = /(<=?)\s*(\d+(?:\.\d+(?:\.\d+)?)?)/.exec(range);

  return ltPattern ? [ltPattern[1], ltPattern[2]] : ['<=', '9999.9999.9999'];
};

const compareSemver = (left, right) => {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  // oxlint-disable-next-line no-plusplus
  for (let i = 0; i < 3; i++) {
    const leftPart = leftParts[i] || 0;
    const rightPart = rightParts[i] || 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
};
