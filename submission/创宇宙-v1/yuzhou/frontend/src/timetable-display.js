// Device display preferences stay outside the workspace, cloud saves and backups.
export const TIMETABLE_DISPLAY_KEY = 'czb-yuzhou-timetable-display-v1';
export const TIMETABLE_SCALE = Object.freeze({min:30, max:180, step:5, default:100});

export function normalizeTimetableScale(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TIMETABLE_SCALE.default;
  return Math.max(TIMETABLE_SCALE.min, Math.min(TIMETABLE_SCALE.max, Math.round(value / TIMETABLE_SCALE.step) * TIMETABLE_SCALE.step));
}

export function createTimetableDisplay(getStorage = () => globalThis.localStorage) {
  let scale = TIMETABLE_SCALE.default;
  return {
    read() {
      try {
        const value = JSON.parse(getStorage().getItem(TIMETABLE_DISPLAY_KEY) || 'null');
        scale = value?.version === 1 && typeof value.scale === 'number' && Number.isFinite(value.scale)
          ? normalizeTimetableScale(value.scale) : TIMETABLE_SCALE.default;
      } catch { /* Keep the current session usable if device storage is unavailable. */ }
      return scale;
    },
    write(value) {
      scale = normalizeTimetableScale(value);
      try {
        getStorage().setItem(TIMETABLE_DISPLAY_KEY, JSON.stringify({version:1, scale}));
        return {scale, saved:true};
      } catch { return {scale, saved:false}; }
    },
  };
}

export const timetableDisplay = createTimetableDisplay();
