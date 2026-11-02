"""Rebuild every non-Estimate view of previews/25-cbam-rail/bento.html in the bento system.
Every figure below is copied from index.html (engine output, see each view's FIGURES comment),
or from the engine call in routes2.mjs / routes3.mjs (route availability)."""
import re, sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, '..', 'preview') + '/'  # repo copy: writes ../preview/bento.html
src = open(D + 'index.html').read()
out = open(os.path.join(HERE, 'bento.before-all.html')).read()  # rebuild from the pre-build copy, never stack

def section(html, v):
    i = html.find(f'<section class="view" data-v="{v}"')
    j = html.find('<section class="view"', i + 10)
    if j < 0:
        j = html.find('</main>', i)
    assert i > 0 and j > i, v
    return i, j

def fp(hex16, cls=''):
    bits = ''.join(f'{int(c, 16):04b}' for c in hex16)
    return f'<div class="b-fp {cls}" aria-hidden="true">' + ''.join(f'<i class="{"on" if b == "1" else ""}"></i>' for b in bits) + '</div>'

GO = '<span class="b-go" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M5 11l6-6M6 5h5v5"/></svg></span>'
def go_btn(view):
    return f'<button class="b-go" data-goto="{view}" aria-label="Open {view}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11l6-6M6 5h5v5"/></svg></button>'

# ---------- pictograms: one ink, tones by alpha (the --ic-* tokens) ----------
A, C, N, K = 'fill:var(--ic-a)', 'fill:var(--ic-c)', 'fill:var(--ic-n)', 'fill:var(--card)'
def pict(body, vb='0 0 220 150', cls='b-pict'):
    return f'<svg class="{cls}" viewBox="{vb}" aria-hidden="true">{body}</svg>'
TUBE = pict(f'<ellipse cx="46" cy="75" rx="20" ry="40" style="{N}"/><path d="M46 35H168a20 40 0 010 80H46z" style="{C}"/>'
            f'<path d="M56 46H160" style="stroke:var(--card);stroke-width:3;stroke-dasharray:6 7;fill:none;opacity:.7"/>'
            f'<ellipse cx="168" cy="75" rx="20" ry="40" style="{A}"/><ellipse cx="168" cy="75" rx="12" ry="27" style="{K}"/>')
BAG = pict(f'<path d="M62 30h96l14 96a10 10 0 01-10 12H58a10 10 0 01-10-12z" style="{C}"/><path d="M62 30h96l-6 18H68z" style="{A}"/>'
           f'<rect x="80" y="70" width="60" height="34" rx="6" style="{K}"/><rect x="92" y="82" width="36" height="10" rx="5" style="{N}"/>')
INGOT = pict(f'<path d="M40 104l26-52h88l26 52z" style="{C}"/><path d="M66 52h88l-12 18H78z" style="{A}"/><path d="M40 104h140v14H40z" style="{N}"/>'
             f'<path d="M66 52l-26 52M154 52l26 52" style="stroke:var(--card);stroke-width:2;opacity:.35;fill:none"/>')
SHEET = pict(f'<rect x="48" y="18" width="124" height="116" rx="10" style="{N}"/><path d="M48 28a10 10 0 0110-10h104a10 10 0 0110 10v18H48z" style="{A}"/>'
             + ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="10" rx="3" style="{K}"/>' for y in (60, 80, 100) for x, w in ((60, 26), (94, 30), (132, 28))))
PAPER = pict(f'<rect x="70" y="24" width="96" height="118" rx="6" style="{N}"/><rect x="56" y="12" width="96" height="118" rx="6" style="{C}"/>'
             f'<rect x="70" y="30" width="54" height="10" rx="3" style="{K}"/>'
             + ''.join(f'<rect x="70" y="{y}" width="{w}" height="6" rx="3" style="{K};opacity:.7"/>' for y, w in ((54, 68), (68, 60), (82, 68), (96, 44))))
SHIELD = pict(f'<path d="M110 14l64 24v42c0 34-26 58-64 66-38-8-64-32-64-66V38z" style="{C}"/>'
              f'<path d="M84 80l18 18 36-40" style="fill:none;stroke:var(--card);stroke-width:10;stroke-linecap:round;stroke-linejoin:round"/>')
PENDING = pict('<rect x="50" y="26" width="120" height="100" rx="16" style="fill:none;stroke:var(--ink-3);stroke-width:3;stroke-dasharray:9 8"/>'
               f'<circle cx="110" cy="76" r="16" style="{N}"/>')
SECT = {  # small sector glyphs for the Good editor (sector from CN chapter, not from a name list)
    'Iron & steel': pict(f'<rect x="4" y="9" width="16" height="6" rx="3" style="{C}"/><circle cx="20" cy="12" r="3" style="{A}"/>', '0 0 24 24', 'b-sg'),
    'Aluminium': pict(f'<path d="M3 18l4-9h10l4 9z" style="{C}"/><path d="M7 9h10l-2 3H9z" style="{A}"/>', '0 0 24 24', 'b-sg'),
    'Cement': pict(f'<path d="M7 4h10l2 16H5z" style="{C}"/><path d="M7 4h10l-1 3H8z" style="{A}"/>', '0 0 24 24', 'b-sg'),
    'Fertilisers': pict(f'<circle cx="8" cy="14" r="4" style="{C}"/><circle cx="16" cy="10" r="4" style="{A}"/><circle cx="15" cy="18" r="2.5" style="{N}"/>', '0 0 24 24', 'b-sg'),
    'Hydrogen': pict(f'<circle cx="8" cy="12" r="5" style="{C}"/><circle cx="17" cy="12" r="4" style="{A}"/>', '0 0 24 24', 'b-sg'),
}

def dots10(n, cls=''):
    return '<div class="b-d10 ' + cls + '">' + ''.join(f'<i class="{"on" if k < n else ""}"></i>' for k in range(10)) + '</div>'

def head(title, sub, extra=''):
    return f'<header class="bt-head"><h1 class="bt-h1">{title}</h1><p class="bt-sub">{sub}</p>{extra}</header>'

PRICE_NOTE = ('<details class="disc quiet"><summary><span>Not yet published · 2</span><span class="chev" aria-hidden="true">›</span></summary>'
              '<ul class="notes"><li class="foot">Certificate counts assume no cross-sectoral correction: the Commission has not published the factor for these years, and it can only reduce the free allocation deducted.</li>'
              '<li class="foot">Certificate price, 2027 and 2028: From 2027 the Commission sets a weekly certificate price, applying to certificates sold in that week (IR (EU) 2025/2548 Arts 5 and 8); none published as at 2026-10-14.</li></ul></details>')

OWN_PRICE = ('<section class="b-t b-own"><p class="b-t-ti">Your own price.</p><p class="b-t-sub">For 2027 and 2028, where none is published.</p>'
             '<label class="b-pricebox"><span>€</span><input class="num" inputmode="decimal" placeholder="—" aria-label="Your own price assumption, € per certificate" value="">'
             '<em>per certificate</em></label>'
             '<p class="b-t-foot">Your assumption, not a forecast and not a published price. It stays on this page and is not saved, exported or sent.</p></section>')

# ================= THREE YEARS =================
def year_tile(y, cert, delta, cost0, cost80, mk, hero=False):
    cls = 'b-t b-yr' + (' b-hero' if hero else '')
    return (f'<section class="{cls}"><div class="b-t-h"><p class="b-t-ti num">{y}.</p><span class="b-t-sub">{delta}</span></div>'
            f'<div class="b-mid num">{cert}</div><p class="b-t-sub">certificates</p>'
            f'<div class="b-yr-cost">{cost0}{cost80}</div>'
            f'<div class="b-mk"><span>Mark-up {mk}%</span>{dots10(mk // 10, "b-bz")}</div></section>')

pub = '<span class="b-tag num">€24,855.80</span><span class="b-t-sub">published €75.36 · 2026-Q1</span>'
none_ = lambda q: f'<span class="b-tag b-none p0">none published</span><span class="b-t-sub p0">price for {q} imports</span>'
mine = lambda v: f'<span class="b-tag num p80">{v}</span><span class="b-t-sub p80">at your €80 · not a published price</span>'
three = (
    '<section class="view" data-v="three-years" hidden><!-- BENTO. Figures: renderOutlook(outlook(pack,{73063077,IN,(C),100,2026-03-15})) as in index.html; '
    'mark-up 10/20/30 from the working table; rise split 86.4 + 11.2 = 97.6 (88.5% / 11.5%). p0/p80 = default view vs &price=80. -->'
    + head('Three years.', 'Same shipment, the law as published.')
    + '<div class="b-bento">'
    + year_tile(2026, '329.8', 'priced', pub, '', 10, hero=True)
    + year_tile(2027, '376.8', '+14.2% on 2026', none_('2027-Q1'), mine('€30,140.40'), 20)
    + year_tile(2028, '427.4', '+29.6% on 2026', none_('2028-Q1'), mine('€34,192.80'), 30)
    + OWN_PRICE
    + '<section class="b-t b-s4 b-rise"><div class="b-t-h"><div><p class="b-t-ti">Why it rises.</p><p class="b-t-sub">Of 97.6 extra certificates by 2028.</p></div>'
      '<span class="b-tag">The benchmark does not change for route (C)</span></div>'
      '<div class="b-split"><div class="b-sp b-sp-bz" style="flex:86.4"><span class="num">+86.4</span><em>Mark-up on default values · 88.5%</em></div>'
      '<div class="b-sp b-sp-ink" style="flex:11.2"><span class="num">+11.2</span><em>Less free allocation · 11.5%</em></div></div>'
      '<p class="b-t-foot"><span>The mark-up no longer applies with verified data.</span><span>Lower benchmark +0</span></p></section>'
    + '<section class="b-t b-s4"><p class="b-t-ti">The working.</p><p class="b-t-sub">Year by year, exact.</p>'
      '<table class="b-wk num"><thead><tr><th></th><th>2026</th><th>2027</th><th>2028</th></tr></thead><tbody>'
      '<tr><th>Emissions counted, tCO₂e<small>default value plus mark-up</small></th><td>475.2<small>mark-up 10%</small></td><td>518.4<small>mark-up 20%</small></td><td>561.6<small>mark-up 30%</small></td></tr>'
      '<tr><th>Free allocation deducted, tCO₂e<small>benchmark × share retained × tonnes</small></th><td>−145.373<small>1.491 × 97.5%</small></td><td>−141.645<small>1.491 × 95%</small></td><td>−134.19<small>1.491 × 90%</small></td></tr>'
      '<tr class="b-wk-sum"><th>Certificates to surrender</th><td>329.828</td><td>376.755</td><td>427.41</td></tr>'
      '<tr><th>Cost<small>price × certificates</small></th><td>€24,855.80<small>published €75.36</small></td><td>—<small>none published</small></td><td>—<small>none published</small></td></tr>'
      '</tbody></table>' + PRICE_NOTE + '</section>'
    + '</div></section>\n')

# ================= WHY IT CHANGES =================
waffle = ''.join(f'<i data-c="{k}"></i>' for k in range(100))
origins = [('United States', 13.028), ('Canada', 20.728), ('Brazil', 46.028), ('Iran', 68.028), ('Chile', 80.128), ('Japan', 88.928), ('South Korea', 92.668),
           ('Türkiye', 101.468), ('Bosnia & Herzegovina', 106.528), ('Taiwan', 111.258), ('Vietnam', 115.328), ('Ukraine', 115.438), ('Serbia', 119.728),
           ('New Zealand', 121.928), ('United Kingdom', 129.628), ('Argentina', 149.428), ('Mexico', 163.728), ('Colombia', 172.528), ('Algeria', 184.628),
           ('Australia', 184.628), ('China', 246.778), ('Russia', 249.528), ('other origins', 310.138), ('South Africa', 318.828), ('India', 329.828),
           ('Kazakhstan', 444.228), ('Indonesia', 762.128)]
assert len(origins) == 27
mx = 762.128
odots = ''.join(f'<i class="{"b-me" if n == "India" else ""}" style="left:calc(14px + (100% - 28px) * {v / mx:.4f})" title="{n} · {v}"></i>' for n, v in origins)
otable = ''.join(f'<tr><td>{n}</td><td class="num">{v:.3f}</td></tr>' for n, v in origins)
share = [(2026, 97.5, 1), (2027, 95, 1), (2028, 90, 1), (2029, 77.5, 0), (2030, 51.5, 0), (2031, 39, 0), (2032, 26.5, 0), (2033, 14, 0), (2034, 0, 0)]
phase = ''.join(f'<div class="b-ph {"b-ph-on" if c else ""}"><b style="height:{s}%"></b><span class="num">{y}</span><em class="num">{s:g}%</em></div>' for y, s, c in share)
mk_cols = ''.join(
    f'<div class="b-mc"><span class="b-mc-top num">{tot}</span><div class="b-mc-bar" style="height:{float(tot) / 427.41 * 170:.0f}px">'
    f'<b style="flex:{add}"><em class="num">+{add}</em></b><i style="flex:{base}"></i></div><span class="b-mc-y num">{y}</span><span class="b-t-sub">mark-up {mk}%</span></div>'
    for y, mk, tot, base, add in ((2026, 10, '329.8', 286.6, 43.2), (2027, 20, '376.8', 290.4, 86.4), (2028, 30, '427.4', 297.8, 129.6)))
why = (
    '<section class="view" data-v="why" hidden><!-- BENTO. Figures from index.html Why view (graphsModel/renderGraphs): 88.5%, 86.4 / 11.2 of 97.6; '
    'capsules base 286.6/290.4/297.8 + mark-up 43.2/86.4/129.6; waffle 69.4/72.7/76.1% -> 69/73/76 cells; phase Art 10a(1a) 97.5..0; 27 origins 13.028..762.128. '
    'The year-by-year step chart and the dot cascade are folded into Three years and the share tile (same numbers). -->'
    + head('Why it changes.', 'The same line, drawn.')
    + '<div class="b-bento">'
    + '<section class="b-t b-s2 b-hero"><div class="b-t-h"><div><p class="b-t-ti">Mark-up share.</p><p class="b-t-sub">Of the rise to 2028.</p></div></div>'
      '<div class="b-mega num">88.5<span class="b-u">%</span></div>'
      '<p class="b-lead">of the rise to 2028 is the mark-up on default values. It no longer applies with verified data.</p>'
      '<div class="b-split b-split-sm"><div class="b-sp b-sp-bz" style="flex:86.4"><span class="num">86.4</span></div><div class="b-sp b-sp-on" style="flex:11.2"><span class="num">11.2</span></div></div>'
      '<p class="b-t-foot num"><span>86.4 of 97.6 certificates</span><span>the rest is free allocation</span></p></section>'
    + '<section class="b-t b-s2 b-waf" data-year="2028"><div class="b-t-h"><div><p class="b-t-ti">Charged.</p><p class="b-t-sub">Certificates per 100 t of emissions counted.</p></div>'
      '<div class="seg b-seg"><button data-wy="2026" data-n="69">2026</button><button data-wy="2027" data-n="73">2027</button><button data-wy="2028" data-n="76" aria-pressed="true">2028</button></div></div>'
      f'<div class="b-waf-row"><div class="b-waffle" aria-hidden="true">{waffle}</div><div><div class="b-mid num" data-wn>76</div><p class="b-t-sub">of every 100 tCO₂e are charged.<br>Free allocation covers the rest.</p>'
      '<p class="b-t-foot num"><span data-wt>2028 · 76.1%</span></p></div></div></section>'
    + '<section class="b-t b-s2"><div class="b-t-h"><div><p class="b-t-ti">What the mark-up adds.</p><p class="b-t-sub">129.6 certificates by 2028, on default values.</p></div></div>'
      f'<div class="b-mcols">{mk_cols}</div><p class="b-t-foot">Bronze: the mark-up. Grey: the Commission\'s base value, as if it were a verified figure. A real verified figure can be higher or lower.</p></section>'
    + '<section class="b-t b-s2"><div class="b-t-h"><div><p class="b-t-ti">Free allocation.</p><p class="b-t-sub">Share retained, Directive 2003/87/EC Art 10a(1a).</p></div><span class="b-tag num">0% in 2034</span></div>'
      f'<div class="b-phase">{phase}</div><p class="b-t-foot"><span>Solid: years computed for this line. Faint: legislated, not computed (defaults are published to 2028 only).</span><span>Steepest step 2030</span></p></section>'
    + '<section class="b-t b-s4 b-orig"><div class="b-t-h"><div><p class="b-t-ti">Does the origin matter?</p><p class="b-t-sub">2026 certificates for this good and route, on each origin\'s default value. 27 published.</p></div></div>'
      '<div class="b-orig-big num"><span>13.0<small>United States</small></span><span class="b-arrow">→</span><span>762.1<small>Indonesia</small></span><span class="b-me-big">India 329.8</span></div>'
      f'<div class="b-strip">{odots}</div>'
      '<p class="b-t-foot">Where goods come from is a fact of the shipment, not a setting.</p>'
      f'<details class="disc quiet"><summary><span>All 27 origins</span><span class="chev" aria-hidden="true">›</span></summary><table class="b-otab">{otable}</table></details></section>'
    + ('<section class="b-t b-s4 b-own b-own-w"><div class="b-own-l"><p class="b-t-ti">What would it cost at my own price?</p><p class="b-t-sub">No price is published for imports in 2027-Q1 or 2028-Q1.</p>'
       '<label class="b-pricebox"><span>€</span><input class="num" inputmode="decimal" placeholder="—" aria-label="Your own price assumption, € per certificate" value=""><em>per certificate</em></label></div>'
       '<div class="b-costs"><div><span class="num">2026</span><b class="num">€24,855.80</b><em>published €75.36 · 2026-Q1</em></div>'
       '<div><span class="num">2027</span><b class="num p0">—</b><b class="num p80">€30,140.40</b><em class="p0">none published</em><em class="p80">at your €80 · yours, not published</em></div>'
       '<div><span class="num">2028</span><b class="num p0">—</b><b class="num p80">€34,192.80</b><em class="p0">none published</em><em class="p80">at your €80 · yours, not published</em></div></div>'
       '<p class="b-t-foot b-own-f">Your price is your assumption, not a forecast. It stays on this page. As at 14 Oct 2026.</p></section>')
    + '</div></section>\n')

# ================= SHIPMENT LIST =================
def pass_tile(n, name, cn, meta, cert, eur, q, share, pic, wf):
    return (f'<section class="b-t b-pass"><div class="b-t-h"><p class="b-t-ti">Line {n}.</p><span class="chip bronze"><i></i>Default + mark-up</span></div>'
            f'{pic}<p class="b-pass-name">{name}</p><p class="b-t-sub num">{meta}</p>'
            f'<div class="b-mid num">{cert}</div><div class="b-tags"><span class="b-tag num">{eur}</span><span class="b-tag num">{q}</span></div>'
            f'<div class="b-share-row"><span>Share of the total</span><span class="num">{share}%</span></div><div class="b-share"><b style="width:{share}%"></b></div>'
            f'<details class="disc quiet"><summary><span>Waterfall</span><span class="chev" aria-hidden="true">›</span></summary><dl class="kv">{wf}</dl></details>'
            f'<button class="b-rm">Remove</button></section>')
kv = lambda rows: ''.join(f'<div><dt>{a}</dt><dd class="num">{b}</dd></div>' for a, b in rows)
lst = (
    '<section class="view" data-v="list" hidden><!-- BENTO. Figures as index.html Shipment list (estimateFromPack/renderLineCard/sumTotals/thresholdByYear). '
    'Shares of the total: 329.828/474.049 = 69.6%, 117.438 = 24.8%, 26.783 = 5.6%. 260 t / 50 t = 5.2x. -->'
    + head('Shipment list.', '3 lines · 260 t · 2026.')
    + '<div class="b-bento">'
    + '<section class="b-t b-s2 b-hero"><div class="b-t-h"><div><p class="b-t-ti">Total.</p><p class="b-t-sub">3 lines · what-if, CSCF unpublished</p></div></div>'
      '<div class="b-mega num">474.049</div><p class="b-t-sub">certificates</p>'
      '<div class="b-tags"><span class="b-tag num">€35,901.31</span></div>'
      '<div class="b-stackbar"><b style="flex:69.6"></b><b style="flex:24.8"></b><b style="flex:5.6"></b></div>'
      '<div class="b-row2"><button class="btn b-add" data-goto="export">Export</button><button class="btn b-ghost" data-goto="estimate">Add a line</button></div></section>'
    + '<section class="b-t b-s2"><div class="b-t-h"><div><p class="b-t-ti">Annual de minimis.</p><p class="b-t-sub">Eligible mass, 2026 · 3 lines</p></div><span class="b-tag">Above threshold</span></div>'
      '<div class="b-mid num">260<span class="b-u">t</span></div>'
      '<div class="b-thr b-thr-l"><b style="width:86.7%"></b><em style="left:16.7%"></em></div>'
      '<p class="b-t-foot num"><span>0</span><span>50 t threshold</span><span>300 t</span></p>'
      '<p class="b-lead2">5.2 times the threshold. The listed 2026 imports exceed it, so the exemption does not apply.</p>'
      '<p class="foot">Regulation (EU) 2025/2083 Article 1 and Annex II (new CBAM Annex VII) · as amended by Reg (EU) 2025/2083</p></section>'
    + '</div><div class="b-bento b-c3">'
    + pass_tile(1, 'Welded tube', '', '73063077 · IN · (C) · 100 t · 15 Mar 2026', '329.828', '€24,855.80', '2026-Q1 · €75.36', 69.6, TUBE,
                kv([('Embedded emissions (direct)', '475.2 tCO₂e'), ('− Free allocation', '145.373 tCO₂e'), ('= Chargeable', '329.828 tCO₂e'), ('CBAM factor 2026', '0.975')]))
    + pass_tile(2, 'Grey Portland cement', '', '25232900 · IN · default · 120 t · 12 May 2026', '117.438', '€8,840.73', '2026-Q2 · €75.28', 24.8, BAG,
                kv([('Embedded emissions (direct)', '183.48 tCO₂e'), ('− Free allocation', '77.922 tCO₂e'), ('+ Indirect (electricity) · no free allocation', '11.88 tCO₂e'), ('= Chargeable', '117.438 tCO₂e'), ('CBAM factor 2026', '0.975')]))
    + pass_tile(3, 'Unwrought aluminium', '', '76011010 · IN · (K) · 40 t · 3 Aug 2026', '26.783', '€2,204.78', '2026-Q3 · €82.32', 5.6, INGOT,
                kv([('Embedded emissions (direct)', '82.28 tCO₂e'), ('− Free allocation', '55.497 tCO₂e'), ('= Chargeable', '26.783 tCO₂e'), ('CBAM factor 2026', '0.975')]))
    + '</div></section>\n')

# ================= EXPORT =================
csvrows = (('l1', '73063077', 'IN', '100', '329.8275', '24855.80'), ('l2', '25232900', 'IN', '120', '117.438', '8840.73'), ('l3', '76011010', 'IN', '40', '26.783', '2204.78'))
csvt = ('<table class="b-csv num"><thead><tr><th>line_id</th><th>cn_code</th><th>origin</th><th>mass_t</th><th>certificates</th><th>cost_eur</th></tr></thead><tbody>'
        + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in csvrows) + '</tbody></table>')
exp = (
    '<section class="view" data-v="export" hidden><!-- BENTO. CSV = first 3 data rows of lines.csv (6 of 33 columns shown). Fingerprints: pack_snapshot and line_fingerprint columns, first 16 hex each. -->'
    + head('Export.', 'Take the shipment out of the browser.')
    + '<div class="b-bento">'
    + f'<section class="b-t b-s2"><div class="b-t-h"><div><p class="b-t-ti">CSV.</p><p class="b-t-sub">33 columns · 3 lines · full precision</p></div></div>{SHEET.replace("b-pict", "b-pict b-pict-sm")}'
      f'<div class="b-csvwrap">{csvt}</div><p class="b-t-foot">6 of 33 columns shown. Unrounded values, every rule locator and both fingerprints travel with it.</p>'
      '<a class="btn b-add" href="lines.csv" download>Download CSV</a></section>'
    + f'<section class="b-t b-s2 b-hero"><div class="b-t-h"><div><p class="b-t-ti">Document.</p><p class="b-t-sub">Printable · generated 2 Nov 2026</p></div></div>{PAPER}'
      '<p class="b-lead">The three lines, the de minimis test, the total, and the framing in full.</p>'
      '<a class="btn b-add" href="document.html" target="_blank" rel="noopener">Open document</a></section>'
    + '<section class="b-t b-s4"><div class="b-t-h"><div><p class="b-t-ti">What travels with it.</p><p class="b-t-sub">Each line, and the rule pack, carries a fingerprint. Same dots, same inputs and rules.</p></div></div>'
      '<div class="b-fps">'
      + f'<figure>{fp("f6af39aed68a4cb3")}<figcaption><b>Rule pack</b><span class="num">f6af39ae…</span></figcaption></figure>'
      + f'<figure>{fp("4a7196c85d9eca27")}<figcaption><b>Line 1</b><span class="num">4a7196c8…</span></figcaption></figure>'
      + f'<figure>{fp("a638fe51ff02e038")}<figcaption><b>Line 2</b><span class="num">a638fe51…</span></figcaption></figure>'
      + f'<figure>{fp("7c18fe97b0c4b0d6")}<figcaption><b>Line 3</b><span class="num">7c18fe97…</span></figcaption></figure>'
      + '</div></section>'
    + '</div></section>\n')

# ================= RULES =================
ri, rj = section(src, 'rules')
rsec = src[ri:rj]
srcs = re.search(r'<ol class="src">.*?</ol>', rsec, re.S).group(0)
framing = re.search(r'Framing · read first</div><p>(.*?)</p>', rsec, re.S).group(1)
method = re.search(r'Method</h2>\s*<p[^>]*>(.*?)</p>', rsec, re.S)
method = method.group(1) if method else re.search(r'Engine and rule corpus.*?</p>', rsec, re.S).group(0)[:-4]
rules = (
    '<section class="view" data-v="rules" hidden><!-- BENTO. Banner verbatim (shown in full here, as approved). Sources list reused verbatim from index.html. -->'
    + head('Rules &amp; sources.', 'What this rests on.')
    + '<div class="b-bento">'
    + f'<section class="b-t b-s2 b-r2 b-hero"><div class="b-t-h"><div><p class="b-t-ti">Framing.</p><p class="b-t-sub">Read first.</p></div></div>{SHIELD.replace("b-pict", "b-pict b-pict-sm")}'
      f'<p class="b-frame-full">{framing}</p></section>'
    + f'<section class="b-t b-s2"><div class="b-t-h"><div><p class="b-t-ti">Not yet published.</p><p class="b-t-sub">Two inputs the law still owes.</p></div><span class="b-tag num">2</span></div>'
      '<div class="b-np"><div class="b-npi"><span class="b-dash"></span><div><b>Cross-sectoral correction factor.</b><p>Certificate counts assume no cross-sectoral correction: the Commission has not published the factor for these years, and it can only reduce the free allocation deducted.</p>'
      '<p class="foot">Delegated Regulation (EU) 2019/331 Art 14(6) · no CSCF published for 2026-2030 as at 2026-08-18</p></div></div>'
      '<div class="b-npi"><span class="b-dash"></span><div><b>Weekly certificate prices, 2027 on.</b><p>From 2027 the Commission sets a weekly certificate price, applying to certificates sold in that week (IR (EU) 2025/2548 Arts 5 and 8); none published as at 2026-10-14.</p></div></div></div></section>'
    + '<section class="b-t"><p class="b-t-ti">Colour key.</p><p class="b-t-sub">Colour only ever marks where a figure came from.</p>'
      '<div class="b-key"><div class="b-k b-k-bz"><b>Bronze.</b><span>Commission default values, and the mark-up on them.</span></div>'
      '<div class="b-k b-k-cy"><b>Cyan.</b><span>Your own verified figures.</span></div><div class="b-k b-k-ink"><b>Ink.</b><span>Everything else.</span></div></div></section>'
    + '<section class="b-t"><div class="b-t-h"><div><p class="b-t-ti">Rule pack.</p><p class="b-t-sub num">eu-cbam-2026-defaults-v3</p></div></div><div class="b-mid num">v3</div>'
      + '<dl class="kv">' + kv([('Supersedes', 'v2'), ('Valid from', '1 Jan 2026'), ('Law as published', '18 Aug 2026'), ('Basis', 'ir-2025-2621 · ir-2026-1740')]) + '</dl>'
      + fp('f6af39aed68a4cb3', 'b-fp-sm') + '</section>'
    + f'<section class="b-t b-s4"><p class="b-t-ti">Method.</p><p class="b-lead2">{method}</p></section>'
    + f'<section class="b-t b-s4 b-srcs"><div class="b-t-h"><div><p class="b-t-ti">Sources.</p><p class="b-t-sub">9, with legal status and retrieval date.</p></div><span class="b-tag num">9</span></div>{srcs}</section>'
    + '</div></section>\n')

# ================= EMPTY =================
empty = (
    '<section class="view" data-v="empty" hidden>'
    + head('Three years.', 'Nothing priced yet.')
    + '<div class="b-bento"><section class="b-t b-s4 b-empty"><div class="b-edeck"><div><span class="num">2026</span><b>—</b></div><div><span class="num">2027</span><b>—</b></div><div><span class="num">2028</span><b>—</b></div></div>'
      '<div><p class="b-mid">Price a line first.</p><p class="b-lead2">The three-year view, the cause split and the working appear once a line is priced on Estimate.</p>'
      '<button class="btn b-add b-add-ink" data-goto="estimate">Go to Estimate</button></div></section></div></section>\n')

for v, new in (('three-years', three), ('why', why), ('list', lst), ('export', exp), ('rules', rules), ('empty', empty)):
    i, j = section(out, v)
    out = out[:i] + new + out[j:]

# ================= EDITORS (modals) =================
sect_chips = ''.join(f'<button class="b-chipbtn{" on" if k == "Iron & steel" else ""}">{g}{k.replace("&", "&amp;")}</button>' for k, g in SECT.items())
cal = ''.join('<i></i>' for _ in range(6)) + ''.join(f'<button class="num{" on" if d == 15 else ""}">{d}</button>' for d in range(1, 32))  # 1 Mar 2026 is a Sunday; Mon-first grid
sheets = f'''
<div class="b-scrim" data-close hidden></div>
<aside class="b-sheet" data-sheet="good" hidden aria-label="Good"><header><div><p class="b-t-ti">Good.</p><p class="b-t-sub">Search the 572 goods this estimator prices.</p></div><button class="b-x" data-close aria-label="Close">×</button></header>
 <label class="b-big-in"><input value="welded tube" aria-label="Search goods"></label>
 <div class="b-chips">{sect_chips}</div>
 <div class="b-res on">{TUBE.replace("b-pict", "b-pict b-pict-xs")}<div><b class="num">73063077</b><p>Other tubes, pipes and hollow profiles, welded, of circular cross-section, of iron or non-alloy steel of an external diameter of &lt;= 168,3 mm (excl. plated or coated with zinc and line pipe of a kind used for oil or gas pipelines, casing and tubing of a kind used in drilling for oil or gas, precision tubes and threaded or threadable tubes "gas pipe")</p></div></div>
 <p class="b-t-foot">Descriptions are the Commission's own. Sectors follow the CBAM Annex I grouping, so some fertilisers sit in chapter 28. No electricity goods are priced here.</p>
 <button class="btn b-add b-add-ink" data-close>Use this good</button></aside>
<aside class="b-sheet" data-sheet="origin" hidden aria-label="Origin and route"><header><div><p class="b-t-ti">Origin &amp; route.</p><p class="b-t-sub">Where it was made, and how.</p></div><button class="b-x" data-close aria-label="Close">×</button></header>
 <label class="b-big-in"><span class="b-mono">IN</span><input value="India" aria-label="Country of origin"></label>
 <p class="b-t-sub" style="margin-top:14px">Production routes offered for 73063077 from India, 2026</p>
 <div class="b-routes"><button class="b-route on"><b>(C)</b><span class="num">329.8 certificates</span><em>Commission default published</em></button>
  <button class="b-route b-route-v"><b>(D)</b><span>Verified figures only</span><em>Benchmark published, no default value</em></button>
  <button class="b-route b-route-v"><b>(E)</b><span>Verified figures only</span><em>Benchmark published, no default value</em></button></div>
 <p class="b-t-foot">The Commission publishes no direct default for (D) or (E) from India, so those routes price only from your own verified figures.</p>
 <button class="btn b-add b-add-ink" data-close>Use India · (C)</button></aside>
<aside class="b-sheet" data-sheet="date" hidden aria-label="Import date"><header><div><p class="b-t-ti">Import date.</p><p class="b-t-sub">The date the goods are imported.</p></div><button class="b-x" data-close aria-label="Close">×</button></header>
 <div class="b-mid num" style="margin:8px 0 6px">15 Mar 2026</div>
 <div class="b-qtr"><i class="on"></i><i></i><i></i><i></i></div><p class="b-t-sub num">2026-Q1 · price €75.36, published 7 Apr 2026</p>
 <div class="b-cal"><p class="b-t-ti num">March 2026.</p><div class="b-cal-g"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>{cal}</div></div>
 <p class="b-t-foot">2026: one price per quarter. From 2027 the price is set weekly; none published yet.</p>
 <button class="btn b-add b-add-ink" data-close>Use 15 Mar 2026</button></aside>
<aside class="b-sheet" data-sheet="mass" hidden aria-label="Net mass"><header><div><p class="b-t-ti">Net mass.</p><p class="b-t-sub">Tonnes, as declared.</p></div><button class="b-x" data-close aria-label="Close">×</button></header>
 <label class="b-big-in b-big-num"><input class="num" inputmode="decimal" value="100" aria-label="Net mass in tonnes"><span>t</span></label>
 <p class="b-hint">Use a decimal point: 0.85, not 0,85.</p>
 <div class="b-thr"><b style="width:100%"></b><em style="left:50%"></em></div><p class="b-t-foot num"><span>0</span><span>50 t threshold · 2026</span><span>above</span></p>
 <p class="b-lead2">This line alone exceeds the 50 t annual threshold, so the exemption does not apply.</p>
 <button class="btn b-add b-add-ink" data-close>Use 100 t</button></aside>
<aside class="b-sheet" data-sheet="data" hidden aria-label="Emissions data"><header><div><p class="b-t-ti">Emissions data.</p><p class="b-t-sub">Whose figures price this line.</p></div><button class="b-x" data-close aria-label="Close">×</button></header>
 <div class="b-choice"><button class="b-ch b-ch-bz on"><b>Commission default + mark-up.</b><span>Published per origin and route. Mark-up 10% in 2026, 20% in 2027, 30% in 2028.</span></button>
 <button class="b-ch b-ch-cy"><b>My verified figures.</b><span>From your installation's verified report. No mark-up.</span></button></div>
 <div class="b-vf"><label class="fl"><span class="micro">Direct emissions, tCO₂e per tonne</span><input class="fi num" inputmode="decimal" placeholder="e.g. 1.85"></label>
 <label class="fl"><span class="micro">Verification reference</span><input class="fi" placeholder="Report or verifier reference"></label></div>
 <p class="b-t-foot">Indirect emissions are not charged for iron and steel, so no indirect field is shown.</p>
 <button class="btn b-add b-add-ink" data-close>Use default values</button></aside>
<script src="bento.js?v=3"></script>'''
out = out.replace('</body>', sheets + '\n</body>', 1)

# ================= ILLUSTRATIONS (medium-large, one ink, tones by alpha) =================
def ill(cls, vb, body):
    return f'<svg class="b-ill {cls}" viewBox="{vb}" aria-hidden="true">{body}</svg>'
F = lambda t: f'style="fill:var(--ic-{t})"'
KN = 'style="fill:var(--card)"'
months = ''.join(f'<rect x="{17 + c * 32}" y="{44 + r * 15}" width="26" height="11" rx="4" ' + (F('a') if r == 0 else 'style="fill:var(--card);opacity:.55"') + '/>' for r in range(4) for c in range(3))
ILL_DATE = ill('b-ill-date', '0 0 120 110', f'<rect x="5" y="14" width="110" height="92" rx="12" {F("n")}/><path d="M5 26a12 12 0 0112-12h86a12 12 0 0112 12v10H5z" {F("c")}/>'
               f'<rect x="30" y="4" width="8" height="20" rx="4" {F("a")}/><rect x="82" y="4" width="8" height="20" rx="4" {F("a")}/>{months}')
ILL_CERT = ill('b-ill-cert', '0 0 180 140', f'<rect x="44" y="10" width="112" height="82" rx="8" {F("n")} transform="rotate(-9 100 51)"/>'
               f'<rect x="34" y="22" width="112" height="82" rx="8" {F("b")} transform="rotate(-4 90 63)"/><rect x="22" y="36" width="118" height="84" rx="8" {F("c")}/>'
               f'<rect x="36" y="52" width="58" height="8" rx="4" {KN}/><rect x="36" y="67" width="80" height="5" rx="2.5" {KN} opacity=".7"/><rect x="36" y="79" width="62" height="5" rx="2.5" {KN} opacity=".7"/>'
               f'<path d="M112 108l-7 24 11-6 7 9 5-23z" {F("a")}/><circle cx="120" cy="104" r="18" {F("a")}/><circle cx="120" cy="104" r="9" {KN}/>')
ILL_FAC = ill('b-ill-fac', '0 0 160 120', f'<rect x="0" y="104" width="160" height="6" rx="3" {F("n")}/><path d="M8 104V60l30 18V60l30 18V44h24v60z" {F("c")}/>'
              f'<rect x="96" y="24" width="15" height="80" rx="3" {F("a")}/><circle cx="118" cy="18" r="11" {F("b")}/><circle cx="135" cy="12" r="14" {F("b")}/><circle cx="151" cy="21" r="9" {F("b")}/>'
              + ''.join(f'<rect x="{x}" y="84" width="11" height="11" rx="2" {KN}/>' for x in (18, 44, 70)))
ILL_VOU = ill('b-ill-vou', '0 0 120 70', f'<path d="M8 6h104a4 4 0 014 4v15a10 10 0 000 20v15a4 4 0 01-4 4H8a4 4 0 01-4-4V45a10 10 0 000-20V10a4 4 0 014-4z" {F("c")}/>'
              '<path d="M86 12v46" style="stroke:var(--card);stroke-width:3;stroke-dasharray:4 5"/>'
              f'<rect x="20" y="22" width="48" height="8" rx="4" {KN}/><rect x="20" y="38" width="34" height="6" rx="3" {KN} opacity=".7"/><circle cx="101" cy="35" r="7" {KN}/>')
ILL_STEPS = ill('b-ill-steps', '0 0 180 130', f'<rect x="10" y="72" width="44" height="48" rx="6" {F("c")}/><rect x="10" y="61" width="44" height="8" rx="4" {F("a")}/>'
                f'<rect x="68" y="66" width="44" height="54" rx="6" {F("c")}/><rect x="68" y="47" width="44" height="16" rx="5" {F("a")}/>'
                f'<rect x="126" y="60" width="44" height="60" rx="6" {F("c")}/><rect x="126" y="33" width="44" height="24" rx="6" {F("a")}/>'
                '<path d="M32 52L90 38L148 24" style="fill:none;stroke:var(--ic-b);stroke-width:3;stroke-dasharray:5 6;stroke-linecap:round"/>'
                f'<path d="M148 14l9 11-13 3z" {F("b")}/>')
ILL_SCALE = ill('b-ill-scale', '0 0 160 120', f'<rect x="77" y="22" width="6" height="84" rx="3" {F("c")}/><rect x="48" y="104" width="64" height="9" rx="4.5" {F("c")}/>'
                f'<path d="M20 46L140 24l1 6L21 52z" {F("a")}/><circle cx="80" cy="35" r="7" {F("a")}/>'
                '<path d="M22 50L10 82M22 50l12 32M139 28l-12 30M139 28l12 30" style="stroke:var(--ic-b);stroke-width:2;fill:none"/>'
                f'<path d="M3 82h38a19 11 0 01-38 0z" {F("a")}/><rect x="12" y="64" width="20" height="17" rx="3" {F("c")}/><rect x="15" y="54" width="14" height="11" rx="3" {F("c")}/>'
                f'<path d="M120 58h38a19 11 0 01-38 0z" {F("b")}/>')
ILL_BOX = ill('b-ill-box', '0 0 180 120', f'<rect x="6" y="28" width="104" height="86" rx="8" {F("c")}/>'
              + ''.join(f'<rect x="{x}" y="38" width="4" height="66" rx="2" {KN} opacity=".35"/>' for x in (24, 44, 64, 84))
              + f'<rect x="116" y="62" width="58" height="52" rx="7" {F("b")}/><rect x="116" y="34" width="32" height="24" rx="5" {F("n")}/>'
              f'<rect x="132" y="82" width="26" height="6" rx="3" {KN} opacity=".6"/>')
ILL_GAUGE = ill('b-ill-gauge', '0 0 160 100', '<path d="M10 90A70 70 0 01150 90" style="fill:none;stroke:var(--ic-n);stroke-width:14;stroke-linecap:round"/>'
                '<path d="M10 90A70 70 0 01143.9 61.5" style="fill:none;stroke:var(--ic-a);stroke-width:14;stroke-linecap:round"/>'
                '<path d="M30.6 61.5L8.9 48.9" style="stroke:var(--card);stroke-width:5"/>'
                '<path d="M80 90L127.5 68.9" style="stroke:var(--ic-c);stroke-width:5;stroke-linecap:round"/>' + f'<circle cx="80" cy="90" r="8" {F("c")}/>')
def ins(after, svg):
    global out
    assert out.count(after) == 1, after[:80]
    out = out.replace(after, after + svg)
ins('<section class="b-t b-s2 b-hero"><div class="b-t-h"><div><p class="b-t-ti">Mark-up share.</p><p class="b-t-sub">Of the rise to 2028.</p></div></div>', ILL_STEPS)
ins('<section class="b-t b-s2 b-waf" data-year="2028">', ILL_SCALE)
ins('<section class="b-t b-s2 b-hero"><div class="b-t-h"><div><p class="b-t-ti">Total.</p><p class="b-t-sub">3 lines · what-if, CSCF unpublished</p></div></div>', ILL_BOX)
ins('<section class="b-t b-s2"><div class="b-t-h"><div><p class="b-t-ti">Annual de minimis.</p><p class="b-t-sub">Eligible mass, 2026 · 3 lines</p></div><span class="b-tag">Above threshold</span></div>', ILL_GAUGE)

# ================= ESTIMATE: inputs left (numbered, visibly editable), results right =================
ei, ej = section(out, 'estimate')
esec = out[ei:ej]
grab = lambda pat: re.search(pat, esec, re.S).group(0)
HERO = grab(r'<section class="b-t b-hero b-s2 b-r2">.*?</section>')
FILL = grab(r'<section class="b-t b-fill b-s2">.*?</section>')
YRS = grab(r'<section class="b-t b-s2 b-yrs".*?</section>')
PROV = grab(r'<section class="b-t b-s2 b-prov">.*?</section>')
EHEAD = grab(r'<header class="bt-head">.*?</header>')
SRCH = '<svg class="b-fi-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>'
CALI = '<svg class="b-fi-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>'
CHEV = '<svg class="b-fi-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>'
step = lambda n: f'<span class="b-step num" aria-hidden="true">{n}</span>'
def inp_ill(vb, body): return f'<svg class="b-ill b-ill-inp" viewBox="{vb}" aria-hidden="true">{body}</svg>'
INP = {
 1: inp_ill('0 0 220 150', f'<ellipse cx="46" cy="75" rx="20" ry="40" {F("n")}/><path d="M46 35H168a20 40 0 010 80H46z" {F("c")}/><path d="M56 46H160" style="stroke:var(--card);stroke-width:4;stroke-dasharray:7 8;fill:none;opacity:.7"/><ellipse cx="168" cy="75" rx="20" ry="40" {F("a")}/><ellipse cx="168" cy="75" rx="12" ry="27" {KN}/>'),
 2: inp_ill('0 0 130 84', f'<path d="M30 78s-22-20-22-38a22 22 0 0144 0c0 18-22 38-22 38z" {F("c")}/><circle cx="30" cy="40" r="8" {KN}/>'
    '<path d="M54 40C78 40 82 14 108 14M54 40H108M54 40C78 40 82 66 108 66" style="fill:none;stroke:var(--ic-b);stroke-width:3;stroke-dasharray:5 5;stroke-linecap:round"/>'
    f'<circle cx="114" cy="14" r="9" {F("a")}/><circle cx="114" cy="40" r="8" {F("n")}/><circle cx="114" cy="66" r="8" {F("n")}/>'),
 3: ILL_DATE.replace('b-ill b-ill-date', 'b-ill b-ill-inp b-ill-inp-sq'),
 4: inp_ill('0 0 130 84', f'<rect x="10" y="66" width="110" height="10" rx="5" {F("c")}/><rect x="58" y="56" width="14" height="12" {F("n")}/><rect x="30" y="18" width="70" height="40" rx="6" {F("a")}/>'
    + ''.join(f'<rect x="{x}" y="24" width="4" height="28" rx="2" {KN} opacity=".4"/>' for x in (44, 56, 68, 80))),
 5: inp_ill('0 0 130 84', f'<rect x="14" y="8" width="62" height="70" rx="6" {F("n")} transform="rotate(-8 45 43)"/><rect x="40" y="10" width="64" height="70" rx="6" {F("c")}/>'
    f'<rect x="50" y="22" width="34" height="6" rx="3" {KN}/><rect x="50" y="34" width="44" height="4" rx="2" {KN} opacity=".7"/><rect x="50" y="44" width="38" height="4" rx="2" {KN} opacity=".7"/>'
    f'<circle cx="100" cy="66" r="13" {F("a")}/><path d="M94 66l4 4 8-9" style="fill:none;stroke:var(--card);stroke-width:3;stroke-linecap:round;stroke-linejoin:round"/>'),
}
INP[4] = INP[4].replace('b-ill b-ill-inp', 'b-ill b-ill-inp b-ill-inp-mass', 1)
INP[5] = ''  # founder 11-02: no illustration on Emissions data
step = lambda n: f'<span class="b-step num" aria-hidden="true">{n}</span>' + INP[n]
inputs = (
  '<aside class="b-inputs" aria-label="Your line">'
  '<div class="b-in-head"><p class="b-t-ti">Your line.</p><p class="b-t-sub">Fill these in, top to bottom. The estimate updates as you go.</p></div>'
  f'<section class="b-t b-inp">{step(1)}<p class="b-t-ti">Good.</p>'
  f'<button class="b-field" data-open="good">{SRCH}<span class="b-fv">73063077 — welded tube</span><em>Change</em></button>'
  '<p class="b-help">Search by CN code or name · iron &amp; steel</p></section>'
  f'<section class="b-t b-inp">{step(2)}<p class="b-t-ti">Origin &amp; route.</p>'
  f'<span class="b-lab">Country of origin</span><button class="b-field" data-open="origin"><span class="b-cc">IN</span><span class="b-fv">India</span>{CHEV}</button>'
  '<span class="b-lab">Production route</span><div class="b-segrow" role="radiogroup" aria-label="Production route">'
  '<button role="radio" aria-checked="true" class="on">(C)</button><button role="radio" aria-checked="false" class="b-vo">(D)<i title="verified figures only"></i></button><button role="radio" aria-checked="false" class="b-vo">(E)<i title="verified figures only"></i></button></div>'
  '<p class="b-help"><i class="b-vdot"></i>(D) and (E) price from verified figures only: no Commission default from India.</p></section>'
  f'<section class="b-t b-inp">{step(3)}<p class="b-t-ti">Import date.</p>'
  f'<button class="b-field" data-open="date"><span class="b-fv num">15 / 03 / 2026</span>{CALI}</button>'
  '<div class="b-qtr"><i class="on"></i><i></i><i></i><i></i></div><p class="b-help num">2026-Q1 · price €75.36, set per quarter in 2026</p></section>'
  f'<section class="b-t b-inp">{step(4)}<label class="b-t-ti" for="inMass">Net mass.</label>'
  '<label class="b-field b-field-big"><input id="inMass" class="num" inputmode="decimal" value="100" autocomplete="off"><span>t</span></label>'
  '<p class="b-help">Use a decimal point: 0.85, not 0,85.</p>'
  '<div class="b-thr"><b style="width:100%"></b><em style="left:50%"></em></div><p class="b-help b-thr-l2 num"><span>0</span><span>50 t de minimis · 2026</span><span>above</span></p></section>'
  f'<section class="b-t b-inp">{step(5)}<p class="b-t-ti">Emissions data.</p>'
  '<div class="b-opts" role="radiogroup" aria-label="Emissions data">'
  '<button role="radio" aria-checked="true" class="b-opt b-opt-bz on"><b>Commission default + mark-up</b><span>Published per origin and route. Mark-up 10% in 2026.</span></button>'
  '<button role="radio" aria-checked="false" class="b-opt b-opt-cy"><b>My verified figures</b><span>From your installation\'s verified report. No mark-up.</span></button></div>'
  '<div class="b-vfields" hidden><label class="b-lab" for="inDir">Direct emissions, tCO₂e per tonne</label><label class="b-field"><input id="inDir" class="num" inputmode="decimal" placeholder="e.g. 1.85"></label>'
  '<label class="b-lab" for="inRef">Verification reference</label><label class="b-field"><input id="inRef" placeholder="Report or verifier reference"></label></div></section>'
  '</aside>')
results = ('<div class="b-bento b-out">' + HERO
           + FILL.replace('<div class="b-fl-in" style="width:69.4%">', '<div class="b-fl-in" style="width:69.4%">' + ILL_FAC, 1).replace('<div class="b-fl-rest">', '<div class="b-fl-rest">' + ILL_VOU, 1)
           + YRS + PROV + '</div>')
newest = ('<section class="view" data-v="estimate" hidden><!-- BENTO v2: inputs left as numbered fields (founder 11-02: users must see how to change values), results right. Figures unchanged. -->'
          + EHEAD + '<div class="b-est">' + inputs + results + '</div></section>\n')
out = out[:ei] + newest + out[ej:]
out = out.replace('bento.css?v=3', 'bento.css?v=23')
open(D + 'bento.html', 'w').write(out)
print('ok', len(out), out.count('data-open='))
