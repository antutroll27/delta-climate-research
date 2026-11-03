(function(){
  var q=new URLSearchParams(location.search), scrim=document.querySelector('.b-scrim');
  function open(k){document.querySelectorAll('.b-sheet').forEach(function(s){s.hidden=s.dataset.sheet!==k});scrim.hidden=!k}
  function waffle(card,n,y,pct){card.querySelectorAll('.b-waffle i').forEach(function(c,i){c.classList.toggle('on',i<n)});
    card.querySelector('[data-wn]').textContent=n;card.querySelector('[data-wt]').textContent=y+' · '+pct;
    card.querySelectorAll('[data-wy]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.wy===y))})}
  function pick(btn){var g=btn.parentElement;g.querySelectorAll('[role=radio]').forEach(function(b){var on=b===btn;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))});
    var vf=btn.closest('.b-inp')&&btn.closest('.b-inp').querySelector('.b-vfields');if(vf)vf.hidden=!btn.classList.contains('b-opt-cy')}
  // entry animation: index children for the stagger, replay on every view entry
  document.querySelectorAll('.b-ill,.b-pict,.b-sg,.b-waffle,.b-fp,.b-d10,.b-strip,.b-phase,.b-mcols,.b-stackbar,.b-split').forEach(function(g){
    Array.prototype.forEach.call(g.children,function(c,i){c.style.setProperty('--i',i)})});
  function animate(v){v.classList.remove('b-anim');void v.offsetWidth;v.classList.add('b-anim')}
  var mo=new MutationObserver(function(ms){ms.forEach(function(m){if(!m.target.hidden)animate(m.target)})});
  document.querySelectorAll('.view').forEach(function(v){mo.observe(v,{attributes:true,attributeFilter:['hidden']});if(!v.hidden)animate(v)});
  var PCT={2026:'69.4%',2027:'72.7%',2028:'76.1%'};
  document.querySelectorAll('.b-waf').forEach(function(c){waffle(c,76,'2028',PCT[2028])});
  if(q.get('price')==='80')document.querySelectorAll('.b-pricebox input').forEach(function(i){i.value='80'});
  if(q.get('modal'))open(q.get('modal'));
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-open],[data-close],[data-wy],[role=radio]');if(!t)return;
    if(t.dataset.open){e.stopPropagation();open(t.dataset.open)}
    else if(t.hasAttribute('data-close')){open(null)}
    else if(t.dataset.wy){waffle(t.closest('.b-waf'),+t.dataset.n,t.dataset.wy,PCT[t.dataset.wy])}
    else if(t.getAttribute('role')==='radio'){pick(t)}
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape')open(null)});
})();
