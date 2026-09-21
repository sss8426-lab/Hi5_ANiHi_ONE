// Shared by metadata listings and the server's external-image gate.
export function instagramPreserveReason(row) {
  const category=String(row.category || '');
  if(row.area==='student-private'||/student|artwork|award/.test(category))return '학생작품·수상작 원본 보존';
  if(row.visibility==='private'||row.protected||row.shareMode==='restricted')return '보호자료 원본 보존';
  if(/admission|document|logo|counseling/.test(category))return '문서·로고·상담자료 원본 보존';
  return '';
}
