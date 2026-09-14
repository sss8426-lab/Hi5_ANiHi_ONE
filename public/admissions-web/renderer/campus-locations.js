(() => {
  const checked='2026-09-12';
  const kookmin='https://www.kookmin.ac.kr/user/unIntr/campusGuide/bukakCampusGuide/index.do';
  // Exact reviewed program identities only. This is a presentation overlay, never
  // a rewrite of admissions-data.json, guideline mappings, or student data.
  const entries=[
    {schools:['국민대'],programs:['금속공예학과','도자공예학과','공간디자인학과','공업디자인학과','시각디자인학과','의상디자인학과'],campus:'북악캠퍼스',campusAliases:['북악'],latitude:37.612173,longitude:126.997656,sourceUrl:kookmin,programSourceUrl:kookmin,locationLabel:'조형관'},
    {schools:['국민대'],programs:['영상디자인학과','자동차.운송디자인학과'],campus:'북악캠퍼스',campusAliases:['북악'],latitude:37.611484,longitude:126.998562,sourceUrl:kookmin,programSourceUrl:kookmin,locationLabel:'형설관'},
    {schools:['국민대'],programs:['AI디자인학과'],campus:'북악캠퍼스',campusAliases:['북악'],latitude:37.612268,longitude:126.99688,sourceUrl:kookmin,programSourceUrl:kookmin,locationLabel:'북악관'},
    {schools:['서울과학기술대'],programs:['도예학과','금속공예디자인학과','조형예술학과','디자인학과','산업디자인전공','시각디자인전공'],campus:'공릉캠퍼스',campusAliases:['공릉'],latitude:37.63186482205055,longitude:127.07752602092229,sourceUrl:'https://www.seoultech.ac.kr/intro/campinfo/location/',programSourceUrl:'https://www.seoultech.ac.kr/univ/univ/mol/intro',locationLabel:'공식 캠퍼스 안내 지도'},
    {
      schools:['한국영상대학교','한국영상대'],
      programs:['영상자율전공학과','영상연출학과','영상촬영조명학과','영상편집제작학과','음향제작학과','영화영상학과','영상디자인학과','방송영상미디어학과','미디어보이스학과','애니메이션전공','게임콘텐츠전공','VFX콘텐츠전공','웹툰웹소설자율전공','만화웹툰전공','웹소설전공','웹툰PD전공','웹툰일러스트전공'],
      campus:'세종 장군면 캠퍼스',campusAliases:['세종'],
      latitude:36.462172912634,longitude:127.21061593393193,
      sourceUrl:'https://edu.pro.ac.kr/content/content05.do',
      programSourceUrl:'https://ipsi.pro.ac.kr/upload/ad/rcrt/ipsi/775513_2027학년도 신입생 모집요강(입학홈페이지) (1).pdf',
      locationLabel:'대학길 300 공식 안내 지도 표식',
      years:[2027],verifiedAt:'2026-09-14',updatedAt:'2026-09-14',
    },
  ].map(entry=>Object.freeze({years:[2026,2027],verifiedAt:checked,updatedAt:checked,...entry,verificationStatus:'verified'}));
  const reviewSources={
    '청강문화산업대학교':'https://www.ck.ac.kr/univ-intro/directions/subway_car',
    '청강문화산업대':'https://www.ck.ac.kr/univ-intro/directions/subway_car',
    '계원예술대학교':'https://en.kaywon.ac.kr/CmsHome/intro_07_01.aspx',
    '계원예술대':'https://en.kaywon.ac.kr/CmsHome/intro_07_01.aspx',
    '한성대':'https://www.hansung.ac.kr/',
    '한양대_에리카':'https://goerica.hanyang.ac.kr/admission/html/campus/major.asp',
    '한양대학교(ERICA)':'https://goerica.hanyang.ac.kr/admission/html/campus/major.asp',
  };
  function resolve(university) {
    const name=university?.name||university?.universityName,major=university?.major||university?.department;
    const candidates=entries.filter(e=>e.schools.includes(name)&&e.programs.includes(major)&&e.years.includes(Number(university.year))
      && (!university.campus||[e.campus,...e.campusAliases].includes(university.campus)));
    if(candidates.length===1)return candidates[0];
    const known=entries.find(e=>e.schools.includes(name));
    return {verificationStatus:known||reviewSources[name]?'needs_review':'unknown',sourceUrl:known?.sourceUrl||reviewSources[name]||null,
      latitude:null,longitude:null,verifiedAt:null,updatedAt:known?.updatedAt||checked};
  }
  window.AdmissionsCampusLocations={entries:Object.freeze(entries),resolve};
})();
