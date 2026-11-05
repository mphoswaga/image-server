/* One EducScope switch controls plan promotion across the suite. */
(()=>{'use strict';let visible=false,pending=false;
 window.EducScopePlans={get visible(){return visible;},refresh};
 async function refresh(){if(pending||document.hidden)return;pending=true;let next=false;try{const response=await fetch('https://educscope.com/api/public-settings',{cache:'no-store',credentials:'omit'});if(response.ok)next=(await response.json()).paymentPlansVisible===true;}catch{}finally{pending=false;}
 visible=next;document.querySelectorAll('[data-plan-label]').forEach(el=>el.textContent=visible?'View plans':'Account');document.documentElement.dataset.paymentPlans=visible?'visible':'hidden';window.dispatchEvent(new CustomEvent('educscope:plans',{detail:{visible}}));}
 refresh();setInterval(refresh,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
