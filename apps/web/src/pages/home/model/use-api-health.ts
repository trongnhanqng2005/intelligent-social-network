import { useEffect, useState } from 'react';
import { HttpClientError } from '../../../shared/api/http-client';
import { checkApiHealth, HealthResponseError } from '../api/health';

const REQUEST_TIMEOUT_MS = 5_000;

export type ApiHealthState =
  | { status: 'loading' }
  | { status: 'success' }
  | { status: 'error'; message: string };

function describeApiFailure(error: unknown): string {
  if (error instanceof HealthResponseError) {
    return error.message;
  }

  if (error instanceof HttpClientError) {
    if (error.kind === 'network') {
      return 'The API could not be reached. Check that the backend is running.';
    }
    if (error.kind === 'http' && error.status !== undefined) {
      return `The API returned HTTP ${error.status}.`;
    }
    return 'The API returned invalid JSON.';
  }

  return 'The API connection could not be verified. Try again.';
}

export function useApiHealth(): {
  state: ApiHealthState;
  retry: () => void;
} {
  const [state, setState] = useState<ApiHealthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isActive = true;
    let timedOut = false;
    const controller = new AbortController();

    setState({ status: 'loading' });

    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    void checkApiHealth({ signal: controller.signal })
      .then(() => {
        if (isActive && !controller.signal.aborted) {
          setState({ status: 'success' });
        }
      })
      .catch((error: unknown) => {
        if (!isActive || (controller.signal.aborted && !timedOut)) {
          return;
        }

        setState({
          status: 'error',
          message: timedOut
            ? 'The API request timed out after 5 seconds.'
            : describeApiFailure(error),
        });
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [attempt]);

  function retry(): void {
    setState({ status: 'loading' });
    setAttempt((currentAttempt) => currentAttempt + 1);
  }

  return { state, retry };
}
