import { DeployError } from '../../../../../src/ci/errors.js';

export default [
  {
    title: 'Clean failure',
    async run() {
      throw new DeployError('token rejected');
    },
  },
];
