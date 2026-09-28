import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { managementArchiveId, managementArchiveType } from '../public/data-core/university-management.js';

export async function managementDeletedIds(db: D1Database, universities: unknown): Promise<string[]> {
  const row = await db.prepare(`SELECT metadata_json FROM data_records
    WHERE id=? AND organization_id=? AND campus_id IS NULL AND source_app='admissions'
    AND record_type=? AND deleted_at IS NULL`)
    .bind(managementArchiveId, DEFAULT_ORGANIZATION_ID, managementArchiveType).first<{metadata_json:string}>();
  if (!row) return [];
  const data = JSON.parse(row.metadata_json);
  if (data.version !== 1 || !Array.isArray(data.archived)) throw new Error('Invalid university management archive');
  const names = new Map((Array.isArray(universities) ? universities : []).map(entry => [String(entry.id), entry.name]));
  // An old numeric ID may be reused after a manual deletion; do not hide a new school.
  return data.archived.filter((entry: {id:string;name:string}) => names.get(String(entry.id)) === entry.name)
    .map((entry: {id:string}) => String(entry.id));
}
