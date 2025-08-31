declare module '@motherduck/wasm-client' {
  export interface MDConnectionConfig {
    mdToken: string;
  }

  export class MDConnection {
    static create(config: MDConnectionConfig): MDConnection;
    isInitialized(): Promise<boolean>;
    evaluateQuery(sql: string): Promise<any>;
    evaluateStreamingQuery(sql: string): Promise<any>;
    prepareQuery(sql: string): Promise<any>;
  }
}