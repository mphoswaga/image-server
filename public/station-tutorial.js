window.StationTutorial = (() => {
  const tutorials = new WeakMap();
  const dismissed = new Set();
  let playing;
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function show(root, {path, title, sample, teacher = false}, onDismiss) {
    if (!root.getClientRects().length || playing?.root === root) return;
    playing?.close(false);
    const dialog = make('dialog','station-cinema');
    const titleId = 'tutorial-' + crypto.randomUUID();
    dialog.setAttribute('aria-labelledby', titleId);
    const heading = make('h2', '', title);
    heading.id = titleId;
    const header = make('header');
    header.append(make('span','cinema-label','Video example'), heading);
    const video = make('video');
    video.controls = video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', title + ' video example');
    video.poster = path + '.jpg';
    video.src = path + '.mp4';
    const track = make('track');
    Object.assign(track,{kind:'captions',srclang:'en',label:'English',default:true,src:path+'.vtt'});
    video.append(track);
    const hint = make('p','cinema-hint',teacher ? 'Playing on your screen.' : 'Watch one example. Start your own task whenever you’re ready.');
    const start = make('button','station-ready',teacher ? 'Back to console' : 'I’m ready to try');
    start.type = 'button';
    start.autofocus = true;
    const footer = make('footer');
    footer.append(hint, start);
    dialog.append(header,video,footer);
    root.append(dialog);
    const observer = new MutationObserver(() => {
      if (!dialog.isConnected || !root.getClientRects().length) close(false);
    });
    function close(remember) {
      observer.disconnect();
      video.pause();
      dialog.close();
      dialog.remove();
      playing = null;
      if (remember) onDismiss?.();
    }
    playing = {root,close};
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style']});
    start.onclick = () => close(true);
    dialog.oncancel = event => { event.preventDefault(); close(true); };
    video.onerror = () => { hint.textContent = teacher ? 'The video could not load. Check the connection and try again.' : sample + ' You can start your task now.'; };
    dialog.showModal();
    video.play().catch(async () => {
      if (!dialog.open || video.error) return;
      video.muted = true;
      try {
        await video.play();
        if (dialog.open) hint.textContent = 'Sound is off. Tap the speaker to hear the example.';
      } catch {
        if (dialog.open && !video.error) hint.textContent = 'Press Play to watch, or start your task now.';
      }
    });
  }
  function attach(root, {path, sample, key, title}) {
    const replay = make('button','station-replay');
    replay.type = 'button';
    const robot = make('img');
    robot.src = '/assets/practice/byte/byte-giving-instructions.png';
    robot.alt = '';
    replay.append(robot, make('span', '', 'Click me to watch the video again'));
    root.prepend(replay);
    function open(replaying = false) {
      show(root, {path, sample, title}, () => {
        dismissed.add(key);
        try { sessionStorage.setItem(key, '1'); } catch {}
        const first = root.querySelector('.station-work input:not([disabled]), .station-work select, .station-work button:enabled');
        (replaying ? replay : (first || replay)).focus({preventScroll:true});
      });
    }
    replay.onclick = () => open(true);
    tutorials.set(root, force => {
      let seen = dismissed.has(key);
      try { seen ||= sessionStorage.getItem(key) === '1'; } catch {}
      if (force || !seen) open();
    });
  }
  function activate(panel, force = false) {
    const play = () => {
      const root = panel?.querySelector('.assessment-station');
      if (root && root.getClientRects().length) tutorials.get(root)?.(force);
    };
    // Use the Next station click to start playback in browsers that require a gesture.
    if (force) play();
    else requestAnimationFrame(play);
  }
  return {attach,activate,show};
})();
