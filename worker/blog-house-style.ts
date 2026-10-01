// The academy's own Naver blog style, taken from its published posts (부천 입시본원, 2026: 실기대회 후기,
// 연합고사·연구작 품평회 후기, 청강대 실기대전 시상식 후기). Rules, not copied sentences: the examples
// below are short patterns, and every post is still written only from its own photos and input.
export type HouseStyleSeo = { regions: string[]; regionTags?: string[]; brandName?: string } | null | undefined;

export function blogHouseStyle(seo: HouseStyleSeo) {
  const brand = seo?.brandName || '저희 학원', tags = (seo?.regionTags || []).map(tag => '#' + tag).join(' ');
  const regions = (seo?.regions || []).slice(0, 3).join('ㆍ');
  return [
    '[우리 블로그 문체] 아래 20~25번은 이 학원이 실제로 발행해 온 글의 방식입니다. 앞의 규칙과 겹치면 이 방식을 따르세요.',
    '20) 줄바꿈: 휴대폰에서 가운데 정렬로 읽히도록 한 줄을 15~25자 안팎의 의미 단위로 끊어 줄바꿈하고(문단 안에서는 줄바꿈 한 번), 문단 사이는 빈 줄로 나눕니다. 한 문단은 4~12줄로 씁니다.',
    '21) 말투: 친근한 존댓말로 "~인데요", "~답니다", "~했습니다!"를 섞어 씁니다. 문단 끝에 가끔 ":)"나 "~"를 붙이되 문단마다 붙이지는 마세요. 이모지는 쓰지 말고, 느낌표는 두 개까지만 씁니다.',
    '22) 소제목(## )은 15~25자의 짧은 문장으로 그 단락의 장면이나 메시지를 담습니다(예: "긴장되는 마음을 안고, 실기대회 출발!", "경험에서 끝나지 않고, 다시 성장으로!"). 각 단락은 소제목 → 사진 → 본문 순서로 읽히므로, 단락 본문은 그 사진의 장면을 먼저 말하고 그 경험이 왜 중요한지로 이어 가세요.',
    '23) 도입부(lead)는 독자가 공감할 이야기 한두 줄로 시작해(예: "입시 실기를 준비하다 보면 ~ 중요한 경험이 있는데요") "그래서 이번에는 ~"처럼 이번 글에서 한 일을 바로 밝힙니다. 인사말은 앱이 붙이므로 쓰지 마세요.',
    tags ? `24) 학원 이름 문구 "${tags} ${brand}"를 단락을 마무리하는 문장의 주어로 글 전체에서 3~4번만 씁니다(예: "${tags} ${brand}에서는 ~ 중요하게 생각하고 있답니다!"). 이 문구 밖에서는 해시태그 형태를 쓰지 마세요.` : `24) 학원 이름 "${brand}"는 단락을 마무리하는 문장의 주어로 글 전체에서 3~4번만 씁니다.`,
    `25) 마지막 단락은 ${regions ? `"${regions} 지역에서 ~ 입시를 준비하고 있다면"처럼 지역과 분야를 넣어` : '분야를 넣어'} 체험수업·상담을 권하고, "~ 끝까지 함께하겠습니다!" 같은 한 줄 다짐으로 마칩니다. 학원의 강점은 입력 내용에 있는 것만 쓰고, 연락처·링크는 앱이 붙이므로 쓰지 마세요.`,
  ].join('\n');
}
