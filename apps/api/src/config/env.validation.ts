const nodeEnvironments = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof nodeEnvironments)[number];

export interface EnvironmentConfig {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  HOST: string;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentConfig {
  const nodeEnv = config.NODE_ENV ?? 'development';
  if (
    typeof nodeEnv !== 'string' ||
    !nodeEnvironments.includes(nodeEnv as NodeEnvironment)
  ) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const portValue = config.PORT ?? '3000';
  if (typeof portValue !== 'string' || !/^\d+$/.test(portValue)) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const hostValue = config.HOST ?? '127.0.0.1';
  if (typeof hostValue !== 'string' || hostValue.trim().length === 0) {
    throw new Error('HOST must be a non-empty string');
  }

  return {
    NODE_ENV: nodeEnv as NodeEnvironment,
    PORT: port,
    HOST: hostValue.trim(),
  };
}
