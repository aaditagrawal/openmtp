// Electron ships a modern V8: compile JSX/modules, not obsolete language proposals.
module.exports = (api) => {
  const development = api.env(['development', 'test']);
  return {
    targets: {
      node: '22.22',
      electron: require('./package.json').devDependencies.electron,
    },
    presets: [
      ['@babel/preset-env', { modules: 'commonjs' }],
      ['@babel/preset-react', { development, runtime: 'automatic' }],
    ],
  };
};
