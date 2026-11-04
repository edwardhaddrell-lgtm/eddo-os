// EDDO OS · web edition settings (lives on Eddo-NAS, shared by every screen).
// Same names as the Wallpaper Engine settings. Don't put your Home Assistant
// token here — each device asks for it once and keeps it to itself.
window.EDDO_WEB_SETTINGS = {
  // every screen
  all: {
    colortheme: "dark",
    sessionname: "EDDO",
    language: "en-US",
  },
  // per-screen layouts, picked in the setup card (or ?device=mac in the address)
  devices: {
    mac: {
      uimargintop: 40,       // clears the menu bar and notch
      bgdim: 60,             // darker background so the text stands out
      showgame: false,             // "Ripple relay" game entry doesn't work in Plash
      showworkbenchbutton: false,  // "Open full workspace" toggle doesn't work in Plash
      burnin: false,         // MacBook screens aren't OLED
      jarvistalk: false,     // the mic button needs the PC controller
      music: false,          // no audio-reactive feed outside Wallpaper Engine
      audioreactive: false,
    },
    tv: {
      uimargintop: 0,
      jarvistalk: false,
      music: false,
      audioreactive: false,
    },
  },
};
