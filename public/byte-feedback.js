(function() {
  // Explicit placements avoid guessing emotion from message text or touching game logic.
  const teacher = document.body.dataset.byteUi === 'teacher';
  const placements = teacher ? {
    'byte-guide': ['.empty-state', '#empty', '#liveRoomEmpty', '#liveRoomState', '.assistant-title'],
    'byte-message': ['#status', '.toast', '#loading.error']
  } : {
    'byte-guide': ['#authIntro', '#authSub', '#sidSub', '#instructions', '#workList .empty', '#step1 > .sub', '#form > .sub'],
    'byte-result': ['#resultScreen', '#scoreWrap'],
    'byte-message': ['div.err:not(#forgotMsg)', '.ok-msg']
  };
  function decorate() {
    for (const [name, selectors] of Object.entries(placements)) {
      document.querySelectorAll(selectors.join(',')).forEach(node => {
        if (!node.classList.contains(name)) node.classList.add(name);
      });
    }
  }
  decorate();
  // Existing screens replace their message nodes after requests and lobby refreshes.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; decorate(); });
  }).observe(document.body, { childList:true, subtree:true });
}());
