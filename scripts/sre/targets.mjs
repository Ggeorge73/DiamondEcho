// The live addresses the SRE checks look at. One place, so a check module
// never spells an address itself. Source: docs/de13-production-setup.md.
export const TARGETS = {
  production: {
    domain: "diamondecho.com",
    publicOrigin: "https://diamondecho.com",
    wwwOrigin: "https://www.diamondecho.com",
    staffOrigin: "https://staff.diamondecho.com",
    apiOrigin: "https://diamondecho-api-180189726732.us-east1.run.app",
    // Georgia MLS hosts the property search shown inside /search. It is not
    // ours: it is checked gently and only as a dependency.
    idxOrigin: "https://georgeolugbe.georgiamls.com",
  },
};

export const USER_AGENT = "DiamondEcho-SRE-Monitor/1 (+https://github.com/Ggeorge73/DiamondEcho)";
