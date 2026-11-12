export default [
  {
    title: 'Boom',
    async run() {
      throw new Error('kaput');
    },
  },
];
