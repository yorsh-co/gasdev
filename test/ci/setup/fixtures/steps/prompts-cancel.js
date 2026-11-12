// @ts-check

/** @type {import('../../../../../src/ci/types.d.ts').DeployStep[]} */
export default [
  {
    title: 'Ask',
    async run(ctx) {
      await ctx.prompt({ type: 'text', name: 'x', message: 'x' });
    },
  },
];
