import type {
  AssetProcessingJobRecord,
  ExportRecord,
  ExtractedImageRecord,
  MatchRecord,
  ProcessingLogRecord,
  SessionRow,
  SheetRowRecord
} from "@/types/database";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type SessionInsert = Omit<SessionRow, "created_at"> & { created_at?: string };
type SessionUpdate = Partial<SessionInsert>;

type SheetRowInsert = SheetRowRecord;
type SheetRowUpdate = Partial<SheetRowRecord>;

type ExtractedImageInsert = ExtractedImageRecord;
type ExtractedImageUpdate = Partial<ExtractedImageRecord>;

type MatchInsert = MatchRecord;
type MatchUpdate = Partial<MatchRecord>;

type AssetProcessingJobInsert = Omit<AssetProcessingJobRecord, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type AssetProcessingJobUpdate = Partial<AssetProcessingJobInsert>;

type ExportInsert = ExportRecord;
type ExportUpdate = Partial<ExportRecord>;

type ProcessingLogInsert = ProcessingLogRecord;
type ProcessingLogUpdate = Partial<ProcessingLogRecord>;

export interface Database {
  public: {
    Tables: {
      sessions: {
        Row: SessionRow;
        Insert: SessionInsert;
        Update: SessionUpdate;
        Relationships: [];
      };
      sheet_rows: {
        Row: SheetRowRecord;
        Insert: SheetRowInsert;
        Update: SheetRowUpdate;
        Relationships: [
          {
            foreignKeyName: "sheet_rows_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          }
        ];
      };
      extracted_images: {
        Row: ExtractedImageRecord;
        Insert: ExtractedImageInsert;
        Update: ExtractedImageUpdate;
        Relationships: [
          {
            foreignKeyName: "extracted_images_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          }
        ];
      };
      matches: {
        Row: MatchRecord;
        Insert: MatchInsert;
        Update: MatchUpdate;
        Relationships: [
          {
            foreignKeyName: "matches_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_sheet_row_id_fkey";
            columns: ["sheet_row_id"];
            isOneToOne: false;
            referencedRelation: "sheet_rows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_image_id_fkey";
            columns: ["image_id"];
            isOneToOne: false;
            referencedRelation: "extracted_images";
            referencedColumns: ["id"];
          }
        ];
      };
      asset_processing_jobs: {
        Row: AssetProcessingJobRecord;
        Insert: AssetProcessingJobInsert;
        Update: AssetProcessingJobUpdate;
        Relationships: [
          {
            foreignKeyName: "asset_processing_jobs_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_processing_jobs_image_id_fkey";
            columns: ["image_id"];
            isOneToOne: false;
            referencedRelation: "extracted_images";
            referencedColumns: ["id"];
          }
        ];
      };
      exports: {
        Row: ExportRecord;
        Insert: ExportInsert;
        Update: ExportUpdate;
        Relationships: [
          {
            foreignKeyName: "exports_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          }
        ];
      };
      processing_logs: {
        Row: ProcessingLogRecord;
        Insert: ProcessingLogInsert;
        Update: ProcessingLogUpdate;
        Relationships: [
          {
            foreignKeyName: "processing_logs_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
