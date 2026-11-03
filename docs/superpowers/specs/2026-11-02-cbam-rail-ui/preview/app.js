(function(){
  var q=new URLSearchParams(location.search), st=document.getElementById('stage'), root=document.documentElement;
  var theme=q.get('theme')||'light', device=q.get('device')||(innerWidth<700?'phone':'desktop'), rail=q.get('rail')||'open', view=q.get('view')||'estimate';
  var MORE=['export','rules'];
  function setTheme(t){theme=t;root.setAttribute('data-theme',t);document.querySelectorAll('[data-theme-set]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.themeSet===t)})}
  function setView(v){view=v;st.dataset.view=v;
    var real=v==='empty'?'three-years':v;
    document.querySelectorAll('.view').forEach(function(s){s.hidden=s.dataset.v!==v});
    document.querySelectorAll('[data-view]').forEach(function(b){b.setAttribute('aria-current',String(b.dataset.view===real))});
    var mb=document.querySelector('[data-more]'); if(mb) mb.setAttribute('aria-current',String(MORE.indexOf(real)>-1));
    var more=document.querySelector('.more'); more.hidden=true;
    var tcs=document.querySelectorAll('[data-tc] .tcard'); tcs.forEach(function(t){t.classList.toggle('empty',v==='empty')});
    document.getElementById('main').scrollTop=0;
    try{var u=new URL(location.href);u.searchParams.set('view',v);history.replaceState(null,'',u)}catch(e){}}
  st.dataset.price=q.get('price')==='80'?'80':'0';st.dataset.device=device; st.dataset.rail=rail; setTheme(theme); setView(view);
  if(view==='empty'){var tc=document.querySelector('[data-tc]');tc.innerHTML='<div class="tcard empty"><div class="micro">Line being priced</div><div class="tc-code">No line yet</div><div class="tc-meta">Price a line to begin</div></div>'}
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-theme-toggle],[data-view],[data-goto],[data-theme-set],[data-collapse],[data-more],.cg-tbl-btn,[data-cg-year]');if(!t)return;
    if(t.hasAttribute('data-theme-toggle')){setTheme(theme==='dark'?'light':'dark')}
    else if(t.dataset.view){setView(t.dataset.view)}
    else if(t.dataset.goto){e.preventDefault();setView(t.dataset.goto)}
    else if(t.dataset.themeSet){setTheme(t.dataset.themeSet)}
    else if(t.hasAttribute('data-collapse')){st.dataset.rail=st.dataset.rail==='open'?'collapsed':'open'}
    else if(t.hasAttribute('data-more')){var m=document.querySelector('.more');m.hidden=!m.hidden}
    else if(t.classList.contains('cg-tbl-btn')){var card=t.closest('.cg-card'),tb=card.querySelector('.cg-tbl');var o=tb.classList.toggle('cg-closed');t.setAttribute('aria-expanded',String(!o))}
    else if(t.dataset.cgYear){var card2=t.closest('.cg-card');card2.querySelectorAll('.cg-cell').forEach(function(c){c.style.opacity=c.dataset.year===t.dataset.cgYear?1:0});card2.querySelectorAll('[data-cg-year]').forEach(function(b){b.setAttribute('aria-pressed',String(b===t))})}
  });
})();
