export function assertPostsScenarioExecutionTarget(input: {
  environment: NodeJS.ProcessEnv;
  cwd: string;
  repositoryRoot: string;
  branch: string;
  baselineAncestor: boolean;
}): true;

export function assertPostsScenarioResourceSafety(input: {
  availableMemoryBytes: number;
  sparkWorkloadActive: boolean;
}): true;

export function assertPostsScenarioPortsFree(ports: number[], host?: string): Promise<true>;

export function assertPostsScenarioRunnerHandoff(input: {
  environment: NodeJS.ProcessEnv;
  marker?: unknown;
  parentPid: number;
  runnerActive?: boolean;
  argv?: string[];
  now?: number;
}): 'denied' | 'discovery' | 'run';

export function runPostsScenario<T>(lifecycle: {
  preflight(): Promise<unknown>;
  prepare(gate: unknown): Promise<void>;
  start(gate: unknown): Promise<void>;
  run(gate: unknown): Promise<T>;
  stop(gate: unknown): Promise<void>;
  dispose(gate: unknown): Promise<void>;
}): Promise<T>;
