import { createGasLoader, loadOrderFiles } from 'gasdev/test';

interface Greeter {
  greet(name: string): string;
}

interface Exports {
  Greeter: new (options?: { greeting?: string }) => Greeter;
}

const load = createGasLoader<Exports>({
  files: ['lib/greeter.types.ts', 'lib/greeter.ts'],
  exports: ['Greeter'],
});

const { Greeter } = load({ Logger: { log: () => undefined }, Error });
const message: string = new Greeter().greet('a');

const untyped = createGasLoader({ files: ['a.ts'], exports: ['A'] })();
const value: unknown = untyped.A;

const ordered: string[] = loadOrderFiles('.');

export { message, ordered, value };
