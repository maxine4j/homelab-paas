export interface TaskRunner {
  start(): Promise<void>;
}
