declare global {
  interface Window {
    acquireVsCodeApi: typeof acquireVsCodeApi;
  }

  function acquireVsCodeApi<State = unknown>(): {
    postMessage(message: unknown): void;
    getState(): State | undefined;
    setState(newState: State): void;
  };
}

export {};
