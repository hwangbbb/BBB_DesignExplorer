"""Inline CSS and JS into one file: dist/BBB_Parametric_Explorer.html (email-able, works offline)."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'parametric.html').read_text(encoding='utf-8')
def css(m): return '<style>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '\n</style>'
def js(m): return '<script>\n' + (root / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script') + '\n</script>'
html = re.sub(r'<link rel="stylesheet" href="([^"?]+)(\?[^"]*)?">', css, html)
html = re.sub(r'<script src="([^"?]+)(\?[^"]*)?"></script>', js, html)
# The overview page is not bundled, so drop its link.
html = re.sub(r'\s*<a href="index.html"[^>]*>Overview</a>', '', html)
out = root / 'dist' / 'BBB_Parametric_Explorer.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, len(html), 'bytes')
