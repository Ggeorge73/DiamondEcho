import { createStaffAuth } from "./firebase-auth.js";
import { qrMatrix } from "./qr.js";
// The page script draws the code itself; it only needs the grid.
window.DIAMOND_ECHO_STAFF_QR = qrMatrix;
window.DIAMOND_ECHO_STAFF_AUTH = createStaffAuth(window.DIAMOND_ECHO_STAFF_CONFIG);
import("./app.js");
