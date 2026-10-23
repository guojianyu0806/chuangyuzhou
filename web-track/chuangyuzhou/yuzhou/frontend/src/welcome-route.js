// One gate per loaded document. Returning to the canvas inside the same document
// must not send the user back through the entrance or persist a visited flag.
export function createWelcomeEntryRoute() {
  let firstRender = true;
  return hash => {
    if (!firstRender) return hash;
    firstRender = false;
    const path = String(hash || '').replace(/^#\/?/, '');
    return ['', 'home', 'home/'].includes(path) ? '#/welcome' : hash;
  };
}
