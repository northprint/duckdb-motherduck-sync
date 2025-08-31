/**
 * Web Worker utilities for background processing
 */

import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import type { SyncError } from '../types/errors';
import { unknownError } from '../types/errors';

// Worker message types
export interface WorkerRequest {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
}

export interface WorkerResponse {
  readonly id: string;
  readonly type: 'success' | 'error';
  readonly payload: unknown;
}

// Worker pool for managing multiple workers
export interface WorkerPool {
  readonly execute: <T>(task: WorkerTask) => TaskEither<SyncError, T>;
  readonly terminate: () => void;
}

export interface WorkerTask {
  readonly type: string;
  readonly payload: unknown;
  readonly timeout?: number;
}

// Check if Web Workers are available
export const isWorkerAvailable = (): boolean => {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined';
};

// Create a worker pool
export const createWorkerPool = (
  workerScript: string | URL,
  poolSize: number = navigator.hardwareConcurrency || 4,
): WorkerPool => {
  if (!isWorkerAvailable()) {
    // Fallback for non-worker environments
    return createFallbackWorkerPool();
  }

  const workers: Worker[] = [];
  const taskQueue: Array<{
    request: WorkerRequest;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  const busyWorkers = new Set<Worker>();

  // Initialize workers
  for (let i = 0; i < poolSize; i++) {
    const worker = new Worker(workerScript);
    
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const taskIndex = taskQueue.findIndex(t => t.request.id === response.id);
      
      if (taskIndex !== -1) {
        const task = taskQueue[taskIndex];
        taskQueue.splice(taskIndex, 1);
        busyWorkers.delete(worker);
        
        if (response.type === 'success') {
          task!.resolve(response.payload);
        } else {
          task!.reject(new Error(String(response.payload)));
        }
        
        // Process next task in queue
        processNextTask();
      }
    };
    
    worker.onerror = (error) => {
      console.error('Worker error:', error);
      busyWorkers.delete(worker);
      processNextTask();
    };
    
    workers.push(worker);
  }

  // Process next task from queue
  const processNextTask = () => {
    if (taskQueue.length === 0) return;
    
    const availableWorker = workers.find(w => !busyWorkers.has(w));
    if (!availableWorker) return;
    
    const task = taskQueue[0];
    if (!task) return;
    
    busyWorkers.add(availableWorker);
    availableWorker.postMessage(task.request);
  };

  return {
    execute: <T>(task: WorkerTask) =>
      TE.tryCatch(
        () => new Promise<T>((resolve, reject) => {
          const id = `${Date.now()}-${Math.random()}`;
          const request: WorkerRequest = {
            id,
            type: task.type,
            payload: task.payload,
          };
          
          const timeoutId = task.timeout
            ? setTimeout(() => {
                const index = taskQueue.findIndex(t => t.request.id === id);
                if (index !== -1) {
                  taskQueue.splice(index, 1);
                  reject(new Error('Worker task timeout'));
                }
              }, task.timeout)
            : undefined;
          
          taskQueue.push({
            request,
            resolve: (value) => {
              if (timeoutId) clearTimeout(timeoutId);
              resolve(value as T);
            },
            reject: (error) => {
              if (timeoutId) clearTimeout(timeoutId);
              reject(error);
            },
          });
          
          processNextTask();
        }),
        (error) => unknownError('Worker execution failed', error),
      ),

    terminate: () => {
      workers.forEach(worker => worker.terminate());
      taskQueue.forEach(task => {
        task.reject(new Error('Worker pool terminated'));
      });
      taskQueue.length = 0;
      workers.length = 0;
      busyWorkers.clear();
    },
  };
};

// Create fallback worker pool for non-worker environments
const createFallbackWorkerPool = (): WorkerPool => ({
  execute: <T>(_task: WorkerTask): TaskEither<SyncError, T> =>
    TE.left(unknownError('Web Workers not available', null)),
  terminate: () => {},
});

// Create inline worker from function
export const createInlineWorker = (
  workerFunction: () => void,
): string => {
  const blob = new Blob(
    [`(${workerFunction.toString()})()`],
    { type: 'application/javascript' },
  );
  return URL.createObjectURL(blob);
};

// Example worker function for data processing
export const createDataProcessorWorker = (): string =>
  createInlineWorker(() => {
    // This runs in the worker context
    self.onmessage = (event: MessageEvent) => {
      const { id, type, payload } = event.data;
      
      try {
        let result: unknown;
        
        switch (type) {
          case 'compress':
            // Simple compression simulation
            result = {
              compressed: true,
              originalSize: JSON.stringify(payload).length,
              data: payload,
            };
            break;
            
          case 'transform':
            // Data transformation
            if (Array.isArray(payload)) {
              result = payload.map((item: any) => ({
                ...item,
                processed: true,
                timestamp: Date.now(),
              }));
            } else {
              result = { ...payload, processed: true };
            }
            break;
            
          default:
            throw new Error(`Unknown task type: ${type}`);
        }
        
        self.postMessage({
          id,
          type: 'success',
          payload: result,
        });
      } catch (error) {
        self.postMessage({
          id,
          type: 'error',
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    };
  });

// Cleanup worker URL
export const cleanupWorkerUrl = (url: string): void => {
  URL.revokeObjectURL(url);
};