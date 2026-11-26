"""Verify the original-format, two-page PDFs exported by Microsoft Excel."""
import json
import re
import statistics
from pathlib import Path
import pdfplumber

root=Path(__file__).resolve().parent.parent/'.build-artifacts/school-excel/native'
cases=['preset-0','thirty-learners','print-layout','many-learners','long-activity','fractional-weights','pending-and-attendance']
report=[]
body_sizes={}
for case in cases:
    with pdfplumber.open(root/f'{case}.pdf') as pdf:
        assert len(pdf.pages)==(3 if case=='long-activity' else 2),(case,'expected one record page and readable summary pages')
        texts=[p.extract_text() or '' for p in pdf.pages]
        normalized=[re.sub(r'\s+',' ',text) for text in texts]
        for p,text in zip(pdf.pages,texts):
            assert (p.width,p.height)==(936,612),(case,'incorrect Folio landscape size')
            assert not re.search(r'#{3,}',text),(case,'overflow')
        first=pdf.pages[0]
        margins=[min(e['x0'] for e in first.edges),first.width-max(e['x1'] for e in first.edges),
                 min(c['top'] for c in first.chars),first.height-max(c['bottom'] for c in first.chars)]
        assert min(margins)>=17 and max(margins)-min(margins)<5,(case,'unequal visual margins',margins)
        assert 'Class Record' in normalized[0] and 'DESCRIPTORS' in normalized[0]
        assert 'Summary of Activities and Topics' not in normalized[0]
        assert 'Summary of Activities and Topics' in normalized[1]
        summary=' '.join(normalized[1:])
        assert all(t in summary for t in ['Written Works','Performance','Assessments','Date','Activity','Topic','Learning competency','HPS'])
        assert not re.search(r'\b[A-Z]{1,3}: ',summary),(case,'Excel column-letter prefixes')
        assert all('Summary of Activities and Topics' in text for text in normalized[1:]),(case,'missing continuation header')
        if case!='long-activity':
            activity=next(w for w in pdf.pages[1].extract_words(extra_attrs=['size']) if w['text']=='1' and w['size']>10)
            assert activity['size']>=12,(case,'summary body font too small',activity['size'])
        assert 'LEARNER' not in normalized[1] and 'Submitted by:' not in normalized[1]
        words=first.extract_words()
        submitted=next(w for w in words if w['text']=='Submitted')
        assert submitted['top']>500,(case,'signatories not at bottom')
        highest=next(w for w in words if w['text']=='HIGHEST')
        # Start at learner 1: the wrapped word SCORE in the HPS heading is
        # below HIGHEST and is not a learner-row glyph.
        body_top=next(w['top'] for w in words if w['text']=='1' and w['x0']<50 and w['top']>highest['bottom'])
        body=[c for c in first.chars if c['top']>=body_top-.1 and c['bottom']<submitted['top']-2]
        body_sizes[case]=statistics.median(c['size'] for c in body)
        horizontal=[e for e in first.edges if e['orientation']=='h']
        for c in body:
            midpoint=(c['x0']+c['x1'])/2
            # PDF font boxes include blank ascender/descender space. Check the
            # central glyph region to avoid treating that space as printed ink.
            inset=c['size']*.2
            assert not any(c['top']+inset<e['top']<c['bottom']-inset and e['x0']+.1<midpoint<e['x1']-.1 for e in horizontal),(case,'text crosses a row border',c['text'])
        if case in ['thirty-learners','many-learners']:
            for n in range(1,31 if case=='thirty-learners' else 66):
                assert re.search(rf'Synthetic, Learner {n}(?!\d)',normalized[0]),(case,'missing learner',n)
        if case=='print-layout':
            for n in range(1,48):
                if n!=4: assert re.search(rf'Synthetic, Learner {n}(?!\d)',normalized[0]),(case,'missing learner',n)
            assert 'Low, Learner' in normalized[0] and 'Synthetic, Last Learner' in normalized[0]
            assert '31 Dec 2026' in summary and '01 Nov 2026' in summary
        if case=='pending-and-attendance': assert '(pending)' in normalized[0],(case,'clipped descriptor')
        if case=='long-activity':
            assert 'Fernández' in normalized[0] and 'Gabriela' in normalized[0],(case,'clipped wrapped name')
            assert '=Literal activity title' in normalized[1],(case,'activity title changed')
            # PDF reading order interleaves the other two register groups.
            assert summary.count('Interpret')==8 and summary.count('explain')==8 and summary.count('evidence.')==14,(case,'clipped competency')
        if case=='thirty-learners':
            signature_name=next(w for w in words if w['text']=='Synthetic' and w['top']>submitted['bottom'])
            assert signature_name['top']-submitted['bottom']>=25,(case,'insufficient signing space')
        report.append({'case':case,'pages':len(pdf.pages),'paper_points':[936,612],'visible_margins_points':margins,
                       'printed_body_font_points':body_sizes[case],'content_and_wrapping':'passed'})
        print(f'PASS {case}: Folio pages, readable summary, all learners, balanced margins, bottom signatures and wrapping')
assert body_sizes['many-learners']<body_sizes['thirty-learners'],'Font must adjust automatically for more learners'
(root/'pdf-results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
