export type RevisionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface DataRow {
  master_id: string;
  payload: Record<string, unknown>;
}

export interface TaskMessage {
  rev_id: number;
  chunk_id: number;
  total_chunks: number;
  rows: DataRow[];
}

export interface ResultMessage {
  rev_id: number;
  chunk_id: number;
  status: 'success' | 'failed';
  data_ids: number[];
  error?: string;
}
