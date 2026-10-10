// 휴대폰으로 DATA CORE를 새로 열면(주소 입력·홈 화면 바로가기·즐겨찾기) 항상 모드 선택에서 시작한다.
// 앱 안에서 이동한 화면, 새로고침·뒤로가기, 그리고 폴더·꿈이음 탭처럼 대상이 정해진 링크(?…, #…)는 그대로 연다.
// 로그인 전이면 서버가 /data-core에서 로그인 화면을 보여 주고, 로그인 후에는 모드 선택으로 돌아온다.
(() => {
  try {
    if (!matchMedia('(max-width: 760px)').matches) return;
    if (location.pathname.replace(/\/+$/, '') === '/data-core' || location.search || location.hash) return;
    const entry = performance.getEntriesByType('navigation')[0];
    if (entry && entry.type !== 'navigate') return;
    let from = '';
    try { from = document.referrer ? new URL(document.referrer).origin : ''; } catch { from = ''; }
    if (from === location.origin) return;
    location.replace('/data-core');
  } catch {
    // 판단할 수 없으면 요청한 화면을 그대로 보여 준다.
  }
})();
