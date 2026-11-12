class DeployError extends Error {
  name = 'DeployError';
}

export default [
  {
    title: 'Foreign failure',
    async run() {
      throw new DeployError('from another install');
    },
  },
];
