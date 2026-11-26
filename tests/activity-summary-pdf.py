"""Verify native Excel PDFs keep even dense summaries on one page."""
from pathlib import Path
import re
import pdfplumber

root=Path(__file__).resolve().parent.parent/'.build-artifacts/activity-summary/native'
sizes={}
for name in ['saved','sparse','empty','dense','reserved-name','many-activities']:
    with pdfplumber.open(root/f'{name}.pdf') as pdf:
        assert len(pdf.pages)==1,(name,'summary must occupy exactly one printed page')
        page=pdf.pages[0]
        text=re.sub(r'\s+',' ',page.extract_text(x_tolerance=.2,y_tolerance=.2) or '')
        assert text.count('Summary of Activities and Topics')==1,(name,'repeated header')
        assert all(label in text for label in ['Date','Activity','Topic','Learning competency','HPS'])
        assert not re.search(r'#{3,}',text),(name,'overflow')
        if name=='empty':
            assert text.count('No activities recorded.')==3
        else:
            words=page.extract_words(extra_attrs=['size'],x_tolerance=.2,y_tolerance=.2)
            labels={label:next(w for w in words if w['text']==label) for label in ['Activity','Topic','Learning','HPS']}
            pad=10*labels['Activity']['size']/14
            def column(start,end):
                crop=page.crop((labels[start]['x0']-pad,labels[start]['bottom']+1,labels[end]['x0']-pad,page.height))
                return re.sub(r'\s+',' ',crop.extract_text(x_tolerance=.2,y_tolerance=.2) or '')
            activity=column('Activity','Topic')
            topic=column('Topic','Learning')
            competency=column('Learning','HPS')
            assert '=Evidence journal <draft> & reflection' in activity,(name,'lost title')
            assert 'Explain evidence and justify conclusions.' in competency,(name,'lost competency')
            sizes[name]=next(w['size'] for w in words if w['text']=='journal')
        if name=='dense':
            assert topic.count('Long saved explanation.')==300,(name,'clipped or omitted note text')
        if name=='many-activities':
            for number in range(2,41):
                assert re.search(rf'Saved activity {number}(?!\d)',activity),(name,'missing activity',number)
        print('PASS',name,'exactly one native summary page; all saved content visible')
assert sizes['dense']<sizes['saved'] and sizes['many-activities']<sizes['saved'],sizes
print('Printed activity font sizes:',sizes)
