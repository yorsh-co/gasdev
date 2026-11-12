// @ts-check
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** @type {import('../../../../../src/ci/types.d.ts').DeployStep[]} */
export default [
  {
    title: 'Record deployment',
    async run(ctx) {
      ctx.env.update({ CUSTOM_TOKEN: 'abc 123' });
      writeFileSync(
        join(ctx.cwd, 'step-ran.json'),
        JSON.stringify({ deployment: ctx.deployment, env: ctx.env.read() }),
      );
    },
  },
];
