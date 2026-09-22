(() => {
  const el = id => document.getElementById(id);
  const escape = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const code = new URLSearchParams(location.search).get('invite');
  if (code) sessionStorage.setItem('lesson_invite', code);
  // Keep invitation errors visible even when local authentication is disabled.
  el('educscopeAuthBox').after(el('authErr'));
  async function json(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Please try again.');
    return data;
  }
  const post = body => ({ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  window.GamesWelcome = {
    async claim(user) {
      const pending = sessionStorage.getItem('lesson_invite');
      if (!pending) return user;
      const data = await json('/api/teacher-access/claim', post({code:pending}));
      sessionStorage.removeItem('lesson_invite');
      history.replaceState(null, '', location.pathname);
      return data.user;
    },
    configure(user) {
      const games = user.accessMode === 'games';
      document.body.classList.toggle('games-only', games);
      if (!games) return false;
      el('greeting').textContent = `Let’s make learning an adventure${user.name ? ', ' + user.name.split(' ')[0] : ''}.`;
      document.querySelector('.hero .tagline').textContent = 'Your lesson. Their next favourite game. Everything you need to get your class playing.';
      el('fromPptxDetails').open = false;
      el('rostersBtn').querySelector('span').textContent='My classes';
      for(const id of ['rostersBack','rostersBackTop','creditsBack','creditsBackTop']) el(id).textContent='Back to my games';
      if (!el('gamesWelcome')) {
        const intro = document.createElement('div');
        intro.id='gamesWelcome'; intro.className='games-intro';
        intro.innerHTML=`<div class="games-kicker">Your classroom, brought to life</div><h2>What will your class play today?</h2><p>Choose an adventure, bring a lesson, and review the questions. You’re in control of when the game begins.</p><div class="game-choices">
          <button type="button" class="game-choice" data-game="colonyquest" aria-pressed="false"><div class="scene" style="background-image:url('/assets/colonyquest/moonroot-meadow.webp')"></div><strong>ColonyQuest</strong><small>One classroom screen · Teams<br>Build a colony and weather the adventure together.</small></button>
          <button type="button" class="game-choice" data-game="fishquest" aria-pressed="false"><div class="scene" style="background-image:url('/assets/fishquest/lagoon.png')"></div><strong>FishQuest</strong><small>Learner devices · Live play<br>Answer, explore, and grow through an ocean adventure.</small></button>
          <button type="button" class="game-choice" data-game="arcade" aria-pressed="false"><div class="scene" style="background:linear-gradient(140deg,#eee6ff,#b5d4ff)">✦</div><strong>Individual arcade</strong><small>Learner devices · Own pace<br>Give everyone room to practise and show what they know.</small></button>
          </div><div class="games-steps"><span><b>1</b> Choose a game</span><span><b>2</b> Upload your lesson</span><span><b>3</b> Review & play</span></div>`;
        el('gamesPanel').prepend(intro);
        intro.addEventListener('click', e => {
          const button=e.target.closest('[data-game]'); if(!button)return;
          intro.querySelectorAll('[data-game]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
          el('pptxGameMode').value=button.dataset.game;
          el('pptxGameMode').dispatchEvent(new Event('change'));
          el('fromPptxDetails').open=true;
          el('fromPptxDetails').scrollIntoView({behavior:'smooth',block:'start'});
          el('pptxSubject').focus({preventScroll:true});
        });
        const help=document.createElement('div'); help.className='games-help';
        help.innerHTML='<strong>A simple start. Room to grow.</strong><br>For ColonyQuest, arrange teams on the classroom screen — no learner accounts are needed. For individual results, add a class in Rosters. Want lesson planning and assessments later? Ask your administrator for full access; your account and games stay with you.';
        el('gamesPanel').append(help);
        const teamNote=document.createElement('p');teamNote.className='games-help';teamNote.id='gamesTeamNote';
        teamNote.textContent='No class list needed. After creating the questions, open ColonyQuest setup to name your teams and try the game.';
        el('pptxRosterPick').parentElement.after(teamNote);
        const updateMode=()=>{
          const colony=el('pptxGameMode').value==='colonyquest';
          el('pptxRosterPick').parentElement.style.display=colony?'none':'';
          teamNote.hidden=!colony;
          intro.querySelectorAll('[data-game]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.game===el('pptxGameMode').value)));
        };
        el('pptxGameMode').addEventListener('change',updateMode);updateMode();
      }
      return true;
    },
  };
  if (code) {
    document.querySelector('.auth-card > .sub').textContent='Create your account to accept your LessonScope invitation.';
  }
  const admin=document.createElement('section');
  admin.className='games-help';
  admin.innerHTML='<h3>Invite a teacher</h3><p>Give each teacher their own invitation. They create an EducScope account and keep it when you upgrade their access. Invitations expire after 30 days.</p><label for="teacherInviteMode">Workspace</label> <select id="teacherInviteMode"><option value="games">Games only</option><option value="full">Full LessonScope</option></select> <button type="button" id="createTeacherInvite" class="btn accent" style="width:auto">Create invitation</button><p id="teacherInviteStatus" role="status"></p><div id="teacherInviteList"></div>';
  el('adminPanel').insertBefore(admin, el('adminPanel').children[1]);
  const accounts=document.createElement('section');
  accounts.className='games-help';
  accounts.innerHTML='<h3>Teacher accounts</h3><p>Remove an EducScope-linked teacher from LessonScope when an account was created by mistake. This also clears their games/full access setting here.</p><p id="teacherAccountStatus" role="status"></p><div id="teacherAccountList"></div>';
  el('adminPanel').insertBefore(accounts, admin.nextSibling);
  async function loadInvites(){
    try {
      const data=await json('/api/admin/teacher-invites');
      el('teacherInviteList').innerHTML=data.invites.slice().reverse().map(i=>`<div class="invite-row"><span><strong>${escape(i.teacher?.name || (i.mode==='games'?'Games invitation':'Full access invitation'))}</strong><br>${i.teacher ? escape(i.teacher.email)+' · '+(i.teacher.accessMode==='games'?'Games only':'Full access') : i.revoked?'Withdrawn':Date.parse(i.expiresAt)<=Date.now()?'Expired':i.claimedBy?'Accepted':'Ready to share'}</span>${!i.claimedBy&&!i.revoked&&Date.parse(i.expiresAt)>Date.now()?`<button class="btn ghost" data-copy="${i.code}">Copy link</button><button class="btn ghost" data-revoke="${i.code}">Withdraw</button>`:''}${i.teacher?.accessMode==='games'?`<button class="btn ghost" data-upgrade="${i.code}">Upgrade to full access</button>`:''}</div>`).join('')||'<p>No invitations yet.</p>';
    }catch(e){el('teacherInviteStatus').textContent=e.message;}
  }
  async function loadAccounts(){
    try {
      const data=await json('/api/admin/accounts');
      const rows=(data.users||[]).filter(u=>u.role!=='student');
      el('teacherAccountList').innerHTML=rows.map(u=>`<div class="invite-row"><span><strong>${escape(u.name||u.email)}</strong><br>${escape(u.email)} · ${escape(u.role||'teacher')} · ${u.accessMode==='games'?'Games only':'Full access'}</span>${window.currentUser&&u.id===window.currentUser.id?'<span class="hint">Current account</span>':`<button class="btn ghost" data-delete-account="${escape(u.id)}" data-delete-email="${escape(u.email)}">Delete</button>`}</div>`).join('')||'<p>No teacher accounts yet.</p>';
    }catch(e){el('teacherAccountStatus').textContent=e.message;}
  }
  el('adminBtn').addEventListener('click',()=>{loadInvites();loadAccounts();});
  el('createTeacherInvite').addEventListener('click',async()=>{
    el('createTeacherInvite').disabled=true;
    try{await json('/api/admin/teacher-invites',post({mode:el('teacherInviteMode').value}));el('teacherInviteStatus').textContent='Invitation ready. Copy the link below and share it with the teacher.';await loadInvites();}
    catch(e){el('teacherInviteStatus').textContent=e.message;}
    finally{el('createTeacherInvite').disabled=false;}
  });
  el('teacherInviteList').addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    try{
      if(b.dataset.copy){await navigator.clipboard.writeText(location.origin+'/welcome-games.html?invite='+b.dataset.copy);el('teacherInviteStatus').textContent='Invitation link copied.';return;}
      b.disabled=true;
      if(b.dataset.upgrade)await json('/api/admin/teacher-invites/'+b.dataset.upgrade+'/upgrade',post({}));
      if(b.dataset.revoke)await json('/api/admin/teacher-invites/'+b.dataset.revoke,{method:'DELETE'});
      await loadInvites();
    }catch(err){el('teacherInviteStatus').textContent=err.message;b.disabled=false;}
  });
  el('teacherAccountList').addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||!b.dataset.deleteAccount)return;
    const email=b.dataset.deleteEmail||'this account';
    if(!confirm(`Delete ${email} from LessonScope? Their local LessonScope access will be removed.`))return;
    try{
      b.disabled=true;
      await json('/api/admin/accounts/'+encodeURIComponent(b.dataset.deleteAccount),{method:'DELETE'});
      el('teacherAccountStatus').textContent='Account removed from LessonScope.';
      await Promise.all([loadAccounts(),loadInvites()]);
    }catch(err){el('teacherAccountStatus').textContent=err.message;b.disabled=false;}
  });
})();
