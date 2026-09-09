const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
export const guidelineScope="organization_id='org-hi5-anihi' AND campus_id IS NULL AND source_app='admissions' AND record_type IN ('university-admission-susi','university-admission-jungsi')";
export function detailUpdateStatement(row,next,now){
  return `UPDATE data_records SET metadata_json=json_set(metadata_json,'$.publicDetails',json(${quote(JSON.stringify(next.publicDetails))}),'$.detailsCheckedAt',${quote(now)}) WHERE ${guidelineScope} AND id=${quote(row.id)} AND deleted_at IS NULL AND metadata_json=${quote(row.metadata_json)};`;
}
