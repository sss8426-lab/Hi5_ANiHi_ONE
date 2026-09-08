"""Export public counseling summaries only; never export monthly plans or rubrics."""
import argparse
import hashlib
import json
from pathlib import Path

import openpyxl


def rows(workbook, sheet):
    values = iter(workbook[sheet].values)
    headers = next(values)
    return [dict(zip(headers, row)) for row in values if row and row[0]]


def export(source, destination):
    career_path = source / '전공_실기_꿈_전공_대학_수업연결DB_v1.xlsx'
    curriculum_path = source / '전공별_3년_36개월_미술교육_커리큘럼_DB_v1.xlsx'
    careers_book = openpyxl.load_workbook(career_path, read_only=True, data_only=True)
    curriculum_book = openpyxl.load_workbook(curriculum_path, read_only=True, data_only=True)
    career_rows = rows(careers_book, '꿈-전공-대학')
    design = {row['ID']: row for row in rows(careers_book, '디자인 세부분류')}
    months = rows(curriculum_book, '36개월 세부커리큘럼')
    tracks = rows(curriculum_book, '전공 트랙')
    # Explicit editorial mappings keep similarly named careers from sharing unrelated paths.
    track_numbers = [1, 1, 2, 2, 3, 4, 2, 2, 5, 5, 5, 6, 7, 7, 7, 7, 8, 8, 9, 9, 10, 11, 12, 12, 13, 14, 15, 16, 16, 17, 18, 19, 20, 21, 22]
    art_tiles = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 5, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 10, 10, 6, 6, 7, 7, 7, 8, 8, 9, 9, 6, 11]
    aliases = {'D002': ['만화가'], 'D004': ['스토리 작가', '콘티·연출가'], 'D005': ['애니메이터', '캐릭터 애니메이터'], 'D007': ['애니메이터·애니메이션 감독'], 'D009': ['게임원화가', '게임그래픽디자이너'], 'D010': ['캐릭터원화가', '게임 캐릭터 디자이너'], 'D011': ['배경원화가'], 'D022': ['UI·UX 디자이너'], 'D023': ['영상·모션그래픽 디자이너']}
    summaries = ['이야기와 그림을 세로 화면에 펼치는 사람', '페이지 속 장면을 연결해 이야기를 전하는 사람', '작가와 함께 작품의 시작과 연재를 만드는 사람', '인물과 사건을 이야기와 콘티로 만드는 사람', '그림에 움직임과 생명력을 불어넣는 사람', '입체 캐릭터의 움직임과 연기를 만드는 사람', '장면과 팀을 연결해 하나의 작품을 만드는 사람', '카메라와 컷으로 이야기의 흐름을 그리는 사람', '상상 속 게임 세계를 눈앞에 그려내는 사람', '세계관에 어울리는 캐릭터를 탄생시키는 사람', '게임 속 여행하고 싶은 공간을 그리는 사람', '플레이하기 편한 게임 화면을 만드는 사람', '한 장의 그림으로 이야기를 전하는 사람', '형태와 표정에 특별한 성격을 담는 사람', '작은 캐릭터로 일상의 감정을 전하는 사람', '글과 그림을 엮어 한 권의 세상을 만드는 사람', '글자와 이미지로 메시지를 전하는 사람', '브랜드만의 표정과 목소리를 만드는 사람', '읽기 좋은 책과 잡지의 흐름을 만드는 사람', '제품을 담는 구조와 첫인상을 만드는 사람', '기억에 남는 아이디어와 캠페인을 만드는 사람', '쓰는 사람을 이해하고 편한 경험을 만드는 사람', '그래픽에 움직임과 리듬을 더하는 사람', '카메라와 편집으로 장면의 감정을 전하는 사람', '생활 속 제품의 모양과 쓰임을 설계하는 사람', '새로운 이동 경험과 자동차를 설계하는 사람', '사람이 머무는 공간과 동선을 설계하는 사람', '전시와 매장의 이야기를 공간에 담는 사람', '무대 위 이야기를 공간으로 만드는 사람', '소재와 실루엣으로 입는 문화를 만드는 사람', '색과 패턴으로 소재에 개성을 더하는 사람', '금속과 보석으로 작은 조형을 만드는 사람', '흙과 유약으로 쓰임 있는 형태를 만드는 사람', '가구와 생활용품으로 일상을 바꾸는 사람', '디자인과 기술을 연결해 새로운 경험을 만드는 사람']
    assert len(career_rows) == len(track_numbers) == len(art_tiles) == len(summaries) == 35
    public_careers = []
    for i, row in enumerate(career_rows):
        detail = design.get(row['ID'], {})
        public_careers.append({
            'id': row['ID'], 'group': row['대분류'], 'family': 'design' if row['대분류'] == '디자인' else 'story',
            'name': row['꿈·희망직업'], 'aliases': aliases.get(row['ID'], []), 'summary': summaries[i],
            'majors': row['관련 전공'].split('·'), 'skills': [s.strip() for s in row['핵심 역량'].split(',')],
            'foundation': row['미술 기초 순서'].split('→'), 'specialization': row['전공 수업 순서'].split('→'),
            'advanced': detail.get('전공 심화', row['전공 수업 순서']).split('→'),
            'preparation': row['입시 준비'], 'outcome': row['권장 결과물'],
            'universityExamples': [s.strip() for s in row['대표 대학·학과 예시'].split('|')],
            'sourceReview': row['검수 상태'], 'sourceDate': row['확인일'].strftime('%Y-%m-%d'),
            'verificationStatus': 'reference-only', 'trackId': f'T{track_numbers[i]:02}', 'art': art_tiles[i],
        })
    public_tracks = []
    for track in tracks:
        monthly = [row for row in months if row['전공 트랙'] == track['전공 트랙']]
        assert len(monthly) == 36 and sorted(row['전체개월'] for row in monthly) == list(range(1, 37))
        public_tracks.append({'id': track['트랙ID'], 'name': track['전공 트랙'], 'structure': track['3년 구조'],
                              'foundation': [row['월 주제'] for row in monthly[:4]],
                              'focus': track['2년차 핵심'].split(' · ')[:4],
                              'project': monthly[-1]['월 주제'], 'admissionRule': track['입시 적용 원칙']})
    data = {'version': '2026-09-08-v1', 'sourceDate': '2026-09-03', 'careers': public_careers, 'tracks': public_tracks,
            'lessonAreas': [{key: row[key] for key in ['단계', '수업영역', '교육목표', '권장 순서']} for row in rows(careers_book, '공통 수업로드맵')],
            'sources': [{'name': row['출처'], 'url': row['URL'], 'purpose': row['활용 정보']} for row in rows(careers_book, '출처·검수')],
            'provenance': [{'file': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in [career_path, curriculum_path]],
            'internalSummary': {'trackCount': len(tracks), 'monthlyPlanCount': len(months), 'monthlyPlansPublished': False}}
    destination.write_text('window.HI5_ROADMAP_CONTENT = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
    print(json.dumps({'careers': len(public_careers), 'tracks': len(public_tracks), 'internalMonthlyPlans': len(months), 'publicMonthlyPlans': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    export(args.source, args.destination)
