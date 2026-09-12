(() => {
  // Seoul City Hall main-building map1: https://www.seoul.go.kr/seoul/map.do
  const origin = Object.freeze({ latitude: 37.5666263, longitude: 126.9783924 });
  const radians = value => value * Math.PI / 180;
  function campusDistance(university) {
    const reviewed = !university?.campusLocation && window.AdmissionsCampusLocations?.resolve(university);
    const point = university?.campusLocation || reviewed;
    // No university-name, region, main-campus, or probability fallback.
    if (!point || point.verificationStatus !== 'verified' || (!reviewed && (!university.campus ||
      point.campus !== university.campus)) || !/^https:\/\/[^\s]+$/.test(point.sourceUrl || '')) return null;
    const { latitude, longitude } = point;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    const a = Math.sin(radians(latitude - origin.latitude) / 2) ** 2 +
      Math.cos(radians(origin.latitude)) * Math.cos(radians(latitude)) * Math.sin(radians(longitude - origin.longitude) / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  }
  function sortByDistance(candidates) {
    return candidates.map((item, index) => ({ ...item, distanceKm: campusDistance(item.u), index }))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.index - b.index)
      .map(({ index, ...item }) => item);
  }
  function reserveNumber(row) {
    for (const value of [row.reserveNumber, row.waitlistNumber, row.resultNote, row.originalResult]) {
      const text = String(value ?? '').trim();
      const match = text.match(/^\d+$/) || text.match(/예비\s*(?:번호\s*)?(\d+)\s*(?:번)?(?!\d)/);
      if (!match) continue;
      const n = Number(match[1] ?? match[0]);
      if (Number.isSafeInteger(n) && n > 0) return n;
    }
    return null;
  }
  function rejectedOrder(rows) {
    return [...rows].sort((a, b) => (reserveNumber(b) ?? -1) - (reserveNumber(a) ?? -1));
  }
  function casePage(rows, requested = 1) {
    const total = Math.max(1, Math.ceil(rows.length / 3));
    const page = Math.max(1, Math.min(total, Number.isSafeInteger(requested) ? requested : 1));
    return { page, total, rows: rows.slice((page - 1) * 3, page * 3) };
  }
  window.AdmissionsCounselingUx = { origin, campusDistance, sortByDistance, reserveNumber, rejectedOrder, casePage };
})();
