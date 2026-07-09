export type OperationStatus = 'success' | 'skipped' | 'conflict' | 'error';

export type OperationResult<T = unknown> =
  | { status: 'success'; data: T }
  | { status: 'skipped'; reason: string; details?: Record<string, unknown> }
  | { status: 'conflict'; reason: string; details?: Record<string, unknown> }
  | { status: 'error'; reason: string; details?: Record<string, unknown> };

export function success<T>(data: T): OperationResult<T> {
  return { status: 'success', data };
}

export function skipped(reason: string, details?: Record<string, unknown>): OperationResult<never> {
  return { status: 'skipped', reason, details };
}

export function conflict(reason: string, details?: Record<string, unknown>): OperationResult<never> {
  return { status: 'conflict', reason, details };
}

export function errorResult(reason: string, details?: Record<string, unknown>): OperationResult<never> {
  return { status: 'error', reason, details };
}

export function isSuccess<T>(result: OperationResult<T>): result is { status: 'success'; data: T } {
  return result.status === 'success';
}
