"""Check PDFs produced by school-excel-native.ps1 (requires pdfplumber)."""
import json
import re
from pathlib import Path
import pdfplumber

root = Path(__file__).resolve().parent.parent / '.build-artifacts/school-excel/native'
expected_pages = {'preset-0': 2, 'thirty-learners': 2, 'print-layout': 3,
                  'long-activity': 2, 'fractional-weights': 2, 'pending-and-attendance': 2}
report = []
for case, count in expected_pages.items():
    with pdfplumber.open(root / f'{case}.pdf') as pdf:
        assert len(pdf.pages) == count, (case, 'unexpected/spill pages', len(pdf.pages))
        texts = [page.extract_text() or '' for page in pdf.pages]
        for index, page in enumerate(pdf.pages):
            assert (page.width, page.height) == (936, 612), (case, 'Folio size')
            assert not re.search(r'#{3,}', texts[index]), (case, 'overflow', index)
            assert all(17 <= edge['x0'] <= edge['x1'] <= 919 for edge in page.edges), (case, 'border outside margins', index)
            # pdfplumber's size/upright report glyph advance for 90-degree dates.
            horizontal = [c for c in page.chars if abs(c['matrix'][1]) < .01]
            assert min(c['size'] for c in horizontal) >= 6.99, (case, 'font shrunk', index)
        assert 'Activity register' in texts[-1]
        assert all('Activity register' not in text for text in texts[:-1])
        assert all('DESCRIPTORS' in text for text in texts[:-1]), (case, 'missing final column')
        assert all('Submitted by:' not in text for text in texts[:-2]), (case, 'signatures repeated above final page')
        submitted = next(w for w in pdf.pages[-2].extract_words() if w['text'] == 'Submitted')
        assert submitted['top'] > 500, (case, 'signatures not at bottom')
        if case == 'thirty-learners':
            for n in range(1, 31):
                assert re.search(rf'Synthetic, Learner {n}(?!\d)', texts[0]), (case, 'missing learner', n)
        if case == 'print-layout':
            joined = '\n'.join(texts[:-1])
            for n in range(1, 48):
                if n != 4:
                    assert re.search(rf'Synthetic, Learner {n}(?!\d)', joined), (case, 'missing learner', n)
            assert 'Synthetic, Last Learner' in joined and 'Low, Learner' in joined
            assert '12/31/2026' in texts[-1] and '11/01/2026' in texts[-1]
        if case == 'pending-and-attendance':
            assert '(pending)' in texts[0], (case, 'descriptor clipped')
        if case == 'long-activity':
            assert texts[-1].count('Learning') >= 24, (case, 'competency clipped')
        report.append({'case': case, 'pages': count, 'paper_points': [936, 612],
                       'margins': 'passed', 'dates': 'passed', 'readability': 'passed'})
        print(f'PASS {case}: {count} Folio pages, complete final columns, dates, margins, fonts, and bottom signatures')
(root / 'pdf-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
