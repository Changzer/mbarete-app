// Shared data, not a Client Component export. The root layout must serialize
// its head synchronously; a client reference here can suspend head hydration
// while the body begins hydrating and leave React's cursor in the head.
export const THEME_STORAGE_KEY = "mb-theme";

/** Apply the saved appearance before first paint, without loading a bundle. */
export const themeBootScript = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v)}}catch(e){}})()`;
