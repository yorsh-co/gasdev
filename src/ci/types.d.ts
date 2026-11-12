/** An expected failure; throw it from a step to fail the deployment cleanly. */
export class DeployError extends Error {
  constructor(message: string, options?: ErrorOptions);
}

export type { Answers, PromptObject } from 'prompts';
import type { Answers, PromptObject } from 'prompts';

/** The deployed Apps Script web app. */
export interface Deployment {
  scriptId: string;
  webappUrl: string;
  deploymentId: string;
  version: string;
}

/** Access to the project's `.env` file. */
export interface EnvAccess {
  /** Parsed `.env`; empty when the file does not exist. */
  read(): Record<string, string>;
  /** Sets keys in place, keeping comments and other lines. Values must not contain newlines. */
  update(values: Record<string, string>): void;
}

/** Console helpers. */
export interface DeployLog {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  raw(message: string): void;
  section(title: string): void;
}

/** What a project-defined step receives. */
export interface DeployContext {
  cwd: string;
  /** The project's package.json. */
  pkg: Record<string, unknown>;
  deployment: Deployment;
  env: EnvAccess;
  prompt(questions: PromptObject | PromptObject[]): Promise<Answers<string>>;
  log: DeployLog;
  /** Opens the script in the Apps Script editor. */
  openScript(): void;
}

/** A project-defined step, run after the deployment and before the summary. */
export interface DeployStep {
  title: string;
  run(ctx: DeployContext): void | Promise<void>;
}
