/**
 * Central application state.
 * All mutations go through direct assignment here;
 * call render() from main.js after changing state.
 */
export const state = {
  screen: 'loading',

  config: null,

  dirs: [],

  files: [],

  currentFolder: null,

  searchQuery: '',

  error: null,

  info: null,

  busy: false,

  actionBusy: false,

  current: null,
};
