// 대표 작품 상세: what each portfolio work is, where it is used, what to put in the portfolio, and the
// representative artists of that field (short checked biography, notable works, official links). Artwork
// images are shown straight from the artist's, publisher's or museum's https address — never copied here.
// careerWorks is keyed by career id; its array follows visualContent.portfolio.items. artists are shared.
import { moreArtists } from './career-artists-more.js?v=20260930-pictures';
import { moreWorks } from './career-works-more.js?v=20260930-pictures';

const a = (name, nameEn, meta, bio, works, links, images = []) => ({name, nameEn, meta, bio, works, links, images});
const link = (label, url) => ({label, url});
const w = (about, uses, portfolio, artists) => ({about, uses, portfolio, artists});

const baseArtists = {
  niemann: a('크리스토프 니만', 'Christoph Niemann', '독일 · 1970년생',
    '독일 슈투트가르트 미술아카데미에서 공부하고 1997년 뉴욕으로 건너가 활동했어요. 적은 선과 재치 있는 아이디어로 복잡한 주제를 한눈에 보여주는 작가로, 2010년 미국 아트디렉터스클럽 명예의 전당에 올랐고 국제그래픽연맹(AGI) 회원이에요.',
    ['《뉴요커》·《뉴욕타임스 매거진》 표지 일러스트', '《뉴요커》 최초의 증강현실(AR) 표지', '그림책 『The Pet Dragon』, 『I LEGO N.Y.』'],
    [link('공식 사이트', 'https://www.christophniemann.com/'), link('뉴요커 표지 작업', 'https://www.christophniemann.com/detail/nyercover/')],
    [{src: 'https://www.christophniemann.com/media/2022/03/aicover-810x1106.jpg', caption: '《뉴요커》 표지 작업', source: '작가 공식 사이트', href: 'https://www.christophniemann.com/detail/nyercover/'},
     {src: 'https://www.christophniemann.com/media/2022/03/clementines-810x1106.jpg', caption: '《뉴요커》 표지 작업', source: '작가 공식 사이트', href: 'https://www.christophniemann.com/detail/nyercover/'}]),
  kimhyungtae: a('김형태', 'Kim Hyung-tae', '대한민국 · 1978년생',
    '『창세기전』 시리즈와 『마그나카르타』의 일러스트로 이름을 알린 게임 일러스트레이터예요. 엔씨소프트에서 『블레이드 & 소울』의 아트 디렉터를 맡았고, 2013년 게임사 시프트업을 세워 대표를 맡고 있어요.',
    ['『블레이드 & 소울』 아트 디렉션', '『데스티니 차일드』(2016) · 『승리의 여신: 니케』(2022)', '『스텔라 블레이드』(2024)'],
    [link('시프트업 공식 사이트', 'https://shiftup.co.kr/')],
    [{src: 'https://image.api.playstation.com/vulcan/ap/rnd/202401/2211/a13905770948a628aa32f517d3ab02123edd730494293a32.png', caption: '『스텔라 블레이드』 대표 이미지', source: 'PlayStation 공식 페이지', href: 'https://www.playstation.com/ko-kr/games/stellar-blade/'},
     {src: 'https://nikke-kr.com/pc/ossweb-img/og_image.jpg', caption: '『승리의 여신: 니케』 대표 이미지', source: '게임 공식 사이트', href: 'https://nikke-kr.com/'}]),
  suzylee: a('이수지', 'Suzy Lee', '대한민국 · 1974년생',
    '그림책의 가운데 접히는 부분을 현실과 상상의 경계로 쓰는 연작으로 세계적으로 알려진 그림책 작가예요. 2022년 어린이책의 노벨상이라 불리는 한스 크리스티안 안데르센상 일러스트레이터 부문을 한국인 최초로 받았어요.',
    ['‘경계 3부작’ 『거울 속으로』(2003) · 『파도야 놀자』(2008) · 『그림자놀이』(2010)', '『파도야 놀자』·『그림자놀이』 뉴욕타임스 올해의 그림책 선정'],
    [link('공식 사이트', 'http://www.suzyleebooks.com/'), link('국제아동도서협의회(IBBY) 2022 수상 안내', 'https://www.ibby.org/subnavigation/archives/hans-christian-andersen-awards/2022')],
    [{src: 'https://cdn.shopify.com/s/files/1/0261/7291/5805/products/9780811859240_large_3d996fc8-f1e5-4609-87f9-9d74a394cdad.jpg?v=1618368624', caption: '『파도야 놀자』(Wave) 표지', source: '크로니클북스 공식 페이지', href: 'https://www.chroniclebooks.com/products/wave-1'}]),
};

const baseWorks = {
  D013: [
    w('잡지·신문 기사나 칼럼, 책 표지에 실려 글의 주제를 한 장의 그림으로 전하는 일러스트예요. 글을 읽는 사람이 그림만 보고도 무엇에 관한 이야기인지 알아채도록, 핵심 메시지를 비유나 상징으로 바꾸는 아이디어가 가장 중요해요.',
      ['잡지·신문 기사와 칼럼', '책·음반 표지', '광고·캠페인 포스터'],
      ['한 주제에 대한 아이디어 스케치 여러 안', '가장 좋은 안을 고른 이유와 완성본', '같은 주제를 다른 매체 크기로 응용한 예'], ['niemann']),
    w('게임·애니메이션·웹툰을 알리는 데 쓰이는 캐릭터의 대표 이미지예요. 캐릭터의 성격과 이야기가 포즈·표정·의상·소품에서 드러나고, 배경과 빛이 그 세계의 분위기를 함께 보여줘야 해요.',
      ['게임 출시·업데이트 대표 이미지', '애니메이션·웹툰 포스터와 표지', '굿즈와 광고 이미지'],
      ['캐릭터 설정화 (앞·옆·뒤, 표정)', '성격이 보이는 포즈 시안 비교', '배경과 조명까지 완성한 키아트 한 장'], ['kimhyungtae']),
    w('하나의 주제나 세계관으로 이어지는 여러 장의 그림이에요. 한 장 한 장이 다른 장면을 보여주면서도 색·선·구도의 규칙이 이어져, 모아 봤을 때 작가만의 이야기와 스타일이 분명하게 느껴져야 해요.',
      ['그림책과 일러스트북', '전시·아트북', '브랜드 캠페인 연작'],
      ['주제와 기획 의도를 적은 한 장', '같은 규칙으로 그린 3~5장의 연작', '연작 전체를 한눈에 보여주는 배치'], ['suzylee']),
  ],
};

export const artists = {...baseArtists, ...moreArtists};
export const careerWorks = {...moreWorks, ...baseWorks};
