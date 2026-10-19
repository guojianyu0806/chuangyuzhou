// One shared creation cursor keeps new cards varied across every workspace.
// Previews are deliberately read-only: opening or cancelling a form is not a creation.
export const CREATION_COLORS = Object.freeze([
  '#AE88FF', '#63E6DC', '#FF9CCE', '#D8F649', '#FFBC7C', '#9DC5FF', '#8EDBE8', '#B3A0FF',
]);

export const isRecordColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const sameColor = (first, second) => isRecordColor(first) && isRecordColor(second) && first.toLowerCase() === second.toLowerCase();

export function previewRecordColor(state) {
  const choices = CREATION_COLORS.filter(color => !sameColor(color, state?.ui?.lastCreatedColor));
  return choices[Math.floor(Math.random() * choices.length)];
}

export function assignRecordColor(state, explicitColor) {
  const selected = isRecordColor(explicitColor) ? explicitColor : previewRecordColor(state);
  state.ui ||= {};
  state.ui.lastCreatedColor = selected;
  return selected;
}

export function createColorDraft(state) {
  const color = previewRecordColor(state);
  let manual = false;
  return {
    color,
    bind(form) {
      // The shared modal restores saved form values before binding listeners.
      // Keep a restored manual choice even though restoration dispatches no event.
      const restoredColor = form?.querySelector?.('[name="color"]')?.value;
      if (isRecordColor(restoredColor) && !sameColor(restoredColor, color)) manual = true;
      const selected = event => {
        if (event.target?.matches?.('[name="color"]')) manual = true;
      };
      form?.addEventListener('input', selected);
      form?.addEventListener('change', selected);
      return () => {
        form?.removeEventListener('input', selected);
        form?.removeEventListener('change', selected);
      };
    },
    commit(value) {
      return assignRecordColor(state, manual ? value : sameColor(color, state?.ui?.lastCreatedColor) ? undefined : color);
    },
  };
}
