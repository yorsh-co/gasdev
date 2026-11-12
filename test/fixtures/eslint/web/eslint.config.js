import { gasEslint } from 'gasdev/eslint';

export default gasEslint({
  web: { files: ['src/web/**/*.ts'], tsconfig: './tsconfig.frontend.json' },
});
